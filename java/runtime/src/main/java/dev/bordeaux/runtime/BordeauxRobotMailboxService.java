package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Caller-driven processor for the constrained Bordeaux robot inbox. Call {@link #periodic()} from robotPeriodic so
 * status follows enabled transitions immediately; activation still rejects unless the robot is disabled. This
 * service creates no watcher, thread, socket, shell, or command execution path.
 */
public final class BordeauxRobotMailboxService {
    static final int MAX_INBOX_ENTRIES = 64;
    static final int MAX_ACK_BYTES = 8 * 1024;
    private static final Pattern REVISION_FILE = Pattern.compile("([A-Za-z0-9._:-]{1,128})\\.bordeaux-revision\\.json");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Path inbox;
    private final Path acknowledgements;
    private final BordeauxRevisionService revisions;
    private final BordeauxRobotStatusPublisher statusPublisher;
    private Boolean publishedDisabled;

    /** Uses the fixed production Bordeaux deployment namespace. */
    public BordeauxRobotMailboxService(BordeauxRevisionService revisions) {
        this(Path.of(BordeauxRobotStatusPublisher.PRODUCTION_DEPLOYMENT_NAMESPACE), revisions);
    }

    /**
     * Creates a service rooted at an already-provisioned namespace. The scoped path exists for robot test harnesses;
     * production callers use the fixed-namespace constructor.
     */
    public BordeauxRobotMailboxService(Path namespace, BordeauxRevisionService revisions) {
        Path root = BordeauxRobotStatusPublisher.requireSafeDirectory(namespace, "Bordeaux deployment namespace");
        this.inbox = BordeauxRobotStatusPublisher.requireSafeDirectory(root.resolve("inbox"), "Bordeaux inbox directory");
        this.acknowledgements = BordeauxRobotStatusPublisher.requireSafeDirectory(
                root.resolve("acks"), "Bordeaux acknowledgment directory");
        this.revisions = Objects.requireNonNull(revisions, "revisions");
        this.statusPublisher = new BordeauxRobotStatusPublisher(root);
    }

    /** Processes the bounded inbox once and publishes status only after a mode transition or activation. */
    public synchronized void periodic() {
        boolean disabledAtStart = revisions.isDisabled();
        try {
            for (Path candidate : candidates()) process(candidate, disabledAtStart);
        } finally {
            publishDisabledTransition();
        }
    }

    private List<Path> candidates() {
        BordeauxRobotStatusPublisher.requireSafeDirectory(inbox, "Bordeaux inbox directory");
        List<Path> candidates = new ArrayList<>();
        try (DirectoryStream<Path> entries = Files.newDirectoryStream(inbox)) {
            int count = 0;
            for (Path entry : entries) {
                if (++count > MAX_INBOX_ENTRIES) {
                    throw new BordeauxRuntimeException("Bordeaux inbox exceeds the entry limit of " + MAX_INBOX_ENTRIES);
                }
                Matcher matcher = REVISION_FILE.matcher(entry.getFileName().toString());
                if (matcher.matches()) candidates.add(entry);
            }
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not inspect the Bordeaux inbox", exception);
        }
        candidates.sort(Comparator.comparing(path -> path.getFileName().toString()));
        return candidates;
    }

    private void process(Path candidate, boolean disabledAtStart) {
        Matcher matcher = REVISION_FILE.matcher(candidate.getFileName().toString());
        if (!matcher.matches() || !candidate.getParent().equals(inbox)) {
            throw new BordeauxRuntimeException("Bordeaux inbox candidate path is invalid");
        }
        String nonce = matcher.group(1);
        Outcome outcome;
        if (!disabledAtStart || !revisions.isDisabled()) {
            outcome = Outcome.rejected("Bordeaux revision activation is allowed only while the robot is disabled");
        } else if (Files.isSymbolicLink(candidate) || !Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)) {
            outcome = Outcome.rejected("Bordeaux inbox candidate must be a regular file");
        } else {
            try {
                if (Files.size(candidate) > BordeauxRevisionReader.MAX_REVISION_BYTES) {
                    outcome = Outcome.rejected("Bordeaux inbox candidate exceeds the revision size limit");
                } else {
                    outcome = Outcome.active(revisions.activate(candidate, nonce));
                }
            } catch (BordeauxRuntimeException activationFailure) {
                outcome = revisions.isDisabled()
                        ? recoverOrReject(candidate, nonce, activationFailure)
                        : Outcome.rejected("Bordeaux revision activation is allowed only while the robot is disabled");
            } catch (IOException exception) {
                outcome = Outcome.rejected("Could not inspect the bounded Bordeaux inbox candidate");
            }
        }
        if (outcome.active()) publishCurrentStatus();
        writeAcknowledgement(nonce, outcome);
        removeCandidate(candidate);
    }

    private void publishDisabledTransition() {
        boolean currentDisabled = revisions.isDisabled();
        if (publishedDisabled == null || publishedDisabled.booleanValue() != currentDisabled) publishCurrentStatus();
    }

    private void publishCurrentStatus() {
        BordeauxRuntimeStatus status = revisions.status();
        statusPublisher.publish(status);
        publishedDisabled = status.disabled();
    }

    private Outcome recoverOrReject(Path candidate, String nonce, BordeauxRuntimeException activationFailure) {
        try {
            Optional<BordeauxActivationAck> recovered = revisions.recoverLatestAcknowledgement(candidate, nonce);
            if (recovered.isPresent()) return Outcome.active(recovered.get());
        } catch (BordeauxRuntimeException ignored) {
            // Keep the original activation failure, which best describes the candidate that was not recoverable.
        }
        return Outcome.rejected(boundedMessage(activationFailure.getMessage()));
    }

    private void writeAcknowledgement(String nonce, Outcome outcome) {
        BordeauxRobotStatusPublisher.requireSafeDirectory(acknowledgements, "Bordeaux acknowledgment directory");
        Path target = acknowledgements.resolve(nonce + ".json");
        if (!target.getParent().equals(acknowledgements)) {
            throw new BordeauxRuntimeException("Bordeaux acknowledgment path is invalid");
        }
        BordeauxRobotStatusPublisher.rejectSymbolicLink(target, "Bordeaux acknowledgment file");
        byte[] contents = serializeAcknowledgement(nonce, outcome);
        if (contents.length > MAX_ACK_BYTES) {
            throw new BordeauxRuntimeException("Bordeaux acknowledgment exceeds the size limit of " + MAX_ACK_BYTES + " bytes");
        }
        Path temporary = null;
        try {
            temporary = Files.createTempFile(acknowledgements, ".ack-", ".tmp");
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(contents);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                throw new BordeauxRuntimeException("Atomic replacement is required for Bordeaux acknowledgments", exception);
            }
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not publish Bordeaux activation acknowledgment", exception);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // A bounded temporary file cannot change the already-published acknowledgment.
                }
            }
        }
    }

    private byte[] serializeAcknowledgement(String nonce, Outcome outcome) {
        BordeauxRuntimeStatus status = revisions.status();
        ObjectNode document = MAPPER.createObjectNode();
        document.put("protocolVersion", BordeauxRobotStatusPublisher.PROTOCOL_VERSION);
        document.put("nonce", nonce);
        document.put("state", outcome.active() ? "active" : "rejected");
        document.put("runtimeId", status.runtimeId());
        document.put("teamNumber", status.teamNumber());
        if (outcome.active()) {
            BordeauxActivationAck acknowledgement = outcome.acknowledgement();
            document.put("revisionId", acknowledgement.revisionId());
            document.put("payloadSha256", acknowledgement.payloadSha256());
            document.put("catalogId", acknowledgement.catalogId());
            document.put("catalogHash", acknowledgement.catalogHash());
            document.put("supportVersion", acknowledgement.supportVersion());
        } else {
            document.put("boundary", "activation");
            document.put("message", outcome.message());
        }
        try {
            return MAPPER.writeValueAsBytes(document);
        } catch (JsonProcessingException exception) {
            throw new BordeauxRuntimeException("Could not serialize Bordeaux activation acknowledgment", exception);
        }
    }

    private static String boundedMessage(String message) {
        String safe = message == null || message.isBlank() ? "Bordeaux activation was rejected" : message;
        return safe.length() <= 512 ? safe : safe.substring(0, 512);
    }

    private static void removeCandidate(Path candidate) {
        try {
            Files.delete(candidate);
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not remove the processed Bordeaux inbox candidate", exception);
        }
    }

    private record Outcome(BordeauxActivationAck acknowledgement, String message) {
        private static Outcome active(BordeauxActivationAck acknowledgement) {
            return new Outcome(Objects.requireNonNull(acknowledgement, "acknowledgement"), null);
        }

        private static Outcome rejected(String message) {
            return new Outcome(null, boundedMessage(message));
        }

        private boolean active() {
            return acknowledgement != null;
        }
    }
}
