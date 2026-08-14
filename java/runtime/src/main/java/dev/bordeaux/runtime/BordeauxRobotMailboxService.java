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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Caller-driven, bounded mailbox for revision activation and retention controls. */
public final class BordeauxRobotMailboxService {
    static final int MAX_INBOX_ENTRIES = 64;
    static final int MAX_ACK_BYTES = 8 * 1024;
    private static final Pattern REVISION_FILE =
            Pattern.compile("([A-Za-z0-9._:-]{1,128})\\.bordeaux-revision\\.json");
    private static final Pattern RETENTION_FILE =
            Pattern.compile("([A-Za-z0-9._:-]{1,128})\\.bordeaux-retention\\.json");
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final Path inbox;
    private final Path acknowledgements;
    private final BordeauxRevisionService revisions;
    private final BordeauxRobotStatusPublisher statusPublisher;
    private Boolean publishedDisabled;

    public BordeauxRobotMailboxService(BordeauxRevisionService revisions) {
        this(Path.of(BordeauxRobotStatusPublisher.PRODUCTION_DEPLOYMENT_NAMESPACE), revisions);
    }

    public BordeauxRobotMailboxService(Path namespace, BordeauxRevisionService revisions) {
        Path root =
                BordeauxRobotStatusPublisher.requireSafeDirectory(
                        namespace, "Bordeaux deployment namespace");
        this.inbox =
                BordeauxRobotStatusPublisher.requireSafeDirectory(
                        root.resolve("inbox"), "Bordeaux inbox directory");
        this.acknowledgements =
                BordeauxRobotStatusPublisher.requireSafeDirectory(
                        root.resolve("acks"), "Bordeaux acknowledgment directory");
        this.revisions = Objects.requireNonNull(revisions, "revisions");
        this.statusPublisher = new BordeauxRobotStatusPublisher(root);
    }

    /**
     * Poll once from robotPeriodic. Enabled candidates are rejected before any candidate metadata
     * is read.
     */
    public synchronized void periodic() {
        boolean disabledAtStart = revisions.isDisabled();
        try {
            Map<String, List<Candidate>> grouped = new LinkedHashMap<>();
            for (Candidate candidate : candidates())
                grouped.computeIfAbsent(candidate.nonce(), ignored -> new ArrayList<>())
                        .add(candidate);
            for (List<Candidate> sameNonce : grouped.values()) {
                if (!disabledAtStart || !revisions.isDisabled()) rejectEnabled(sameNonce);
                else if (sameNonce.size() > 1) rejectCollision(sameNonce);
                else process(sameNonce.get(0), disabledAtStart);
            }
        } finally {
            publishDisabledTransition();
        }
    }

    private List<Candidate> candidates() {
        BordeauxRobotStatusPublisher.requireSafeDirectory(inbox, "Bordeaux inbox directory");
        List<Candidate> result = new ArrayList<>();
        try (DirectoryStream<Path> entries = Files.newDirectoryStream(inbox)) {
            int count = 0;
            for (Path entry : entries) {
                if (++count > MAX_INBOX_ENTRIES)
                    throw new BordeauxRuntimeException(
                            "Bordeaux inbox exceeds the entry limit of " + MAX_INBOX_ENTRIES);
                String file = entry.getFileName().toString();
                Matcher revision = REVISION_FILE.matcher(file);
                Matcher retention = RETENTION_FILE.matcher(file);
                if (revision.matches())
                    result.add(new Candidate(entry, revision.group(1), Kind.REVISION));
                else if (retention.matches())
                    result.add(new Candidate(entry, retention.group(1), Kind.RETENTION));
            }
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not inspect the Bordeaux inbox", exception);
        }
        result.sort(Comparator.comparing(candidate -> candidate.path().getFileName().toString()));
        return result;
    }

    private void rejectCollision(List<Candidate> candidates) {
        String nonce = candidates.get(0).nonce();
        Outcome outcome =
                Outcome.rejected(
                        "mailbox",
                        "Bordeaux inbox has colliding revision and retention controls for this"
                            + " nonce");
        writeAcknowledgement(nonce, outcome);
        candidates.forEach(candidate -> removeCandidate(candidate.path()));
    }

    private void rejectEnabled(List<Candidate> candidates) {
        Candidate first = candidates.get(0);
        String boundary = candidates.size() == 1 ? first.kind().boundary() : "mailbox";
        writeAcknowledgement(
                first.nonce(),
                Outcome.rejected(
                        boundary,
                        "Bordeaux revision activation is allowed only while the robot is"
                            + " disabled"));
        candidates.forEach(candidate -> removeCandidate(candidate.path()));
    }

    private void process(Candidate candidate, boolean disabledAtStart) {
        Outcome outcome;
        if (!disabledAtStart || !revisions.isDisabled()) {
            outcome =
                    Outcome.rejected(
                            candidate.kind().boundary(),
                            "Bordeaux revision activation is allowed only while the robot is"
                                + " disabled");
        } else if (Files.isSymbolicLink(candidate.path())
                || !Files.isRegularFile(candidate.path(), LinkOption.NOFOLLOW_LINKS)) {
            outcome =
                    Outcome.rejected(
                            candidate.kind().boundary(),
                            "Bordeaux inbox candidate must be a regular file");
        } else {
            outcome = candidate.kind() == Kind.REVISION ? activate(candidate) : retain(candidate);
        }
        if (outcome.changed()) publishCurrentStatus();
        writeAcknowledgement(candidate.nonce(), outcome);
        removeCandidate(candidate.path());
    }

    private Outcome activate(Candidate candidate) {
        try {
            if (Files.size(candidate.path()) > BordeauxRevisionReader.MAX_REVISION_BYTES)
                return Outcome.rejected(
                        "activation", "Bordeaux inbox candidate exceeds the revision size limit");
            return Outcome.success(
                    "active", revisions.activate(candidate.path(), candidate.nonce()));
        } catch (BordeauxRuntimeException exception) {
            if (!revisions.isDisabled())
                return Outcome.rejected(
                        "activation",
                        "Bordeaux revision activation is allowed only while the robot is disabled");
            try {
                Optional<BordeauxActivationAck> recovered =
                        revisions.recoverLatestAcknowledgement(candidate.path(), candidate.nonce());
                if (recovered.isPresent()) return Outcome.success("active", recovered.get());
            } catch (BordeauxRuntimeException ignored) {
            }
            return Outcome.rejected("activation", boundedMessage(exception.getMessage()));
        } catch (IOException exception) {
            return Outcome.rejected(
                    "activation", "Could not inspect the bounded Bordeaux inbox candidate");
        }
    }

    private Outcome retain(Candidate candidate) {
        try {
            if (Files.size(candidate.path()) > BordeauxRetentionControl.MAX_BYTES)
                return Outcome.rejected(
                        "retention", "Bordeaux retention control exceeds the size limit");
            BordeauxActivationAck acknowledgement =
                    revisions.applyRetention(candidate.path(), candidate.nonce());
            return Outcome.success(
                    acknowledgement.action().equals("pin") ? "pinned" : "active", acknowledgement);
        } catch (BordeauxRuntimeException exception) {
            if (!revisions.isDisabled())
                return Outcome.rejected(
                        "retention",
                        "Bordeaux revision activation is allowed only while the robot is disabled");
            try {
                Optional<BordeauxActivationAck> recovered =
                        revisions.recoverRetentionAcknowledgement(
                                candidate.path(), candidate.nonce());
                if (recovered.isPresent())
                    return Outcome.success(
                            recovered.get().action().equals("pin") ? "pinned" : "active",
                            recovered.get());
            } catch (BordeauxRuntimeException ignored) {
            }
            return Outcome.rejected("retention", boundedMessage(exception.getMessage()));
        } catch (IOException exception) {
            return Outcome.rejected(
                    "retention", "Could not inspect the bounded Bordeaux inbox candidate");
        }
    }

    private void publishDisabledTransition() {
        boolean current = revisions.isDisabled();
        if (publishedDisabled == null || publishedDisabled.booleanValue() != current)
            publishCurrentStatus();
    }

    private void publishCurrentStatus() {
        BordeauxRuntimeStatus status = revisions.status();
        statusPublisher.publish(status);
        publishedDisabled = status.disabled();
    }

    private void writeAcknowledgement(String nonce, Outcome outcome) {
        BordeauxRobotStatusPublisher.requireSafeDirectory(
                acknowledgements, "Bordeaux acknowledgment directory");
        Path target = acknowledgements.resolve(nonce + ".json");
        if (!target.getParent().equals(acknowledgements))
            throw new BordeauxRuntimeException("Bordeaux acknowledgment path is invalid");
        BordeauxRobotStatusPublisher.rejectSymbolicLink(target, "Bordeaux acknowledgment file");
        byte[] contents = serializeAcknowledgement(nonce, outcome);
        if (contents.length > MAX_ACK_BYTES)
            throw new BordeauxRuntimeException(
                    "Bordeaux acknowledgment exceeds the size limit of "
                            + MAX_ACK_BYTES
                            + " bytes");
        Path temporary = null;
        try {
            temporary = Files.createTempFile(acknowledgements, ".ack-", ".tmp");
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer bytes = ByteBuffer.wrap(contents);
                while (bytes.hasRemaining()) channel.write(bytes);
                channel.force(true);
            }
            try {
                Files.move(
                        temporary,
                        target,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                throw new BordeauxRuntimeException(
                        "Atomic replacement is required for Bordeaux acknowledgments", exception);
            }
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException(
                    "Could not publish Bordeaux acknowledgment", exception);
        } finally {
            if (temporary != null)
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                }
        }
    }

    private byte[] serializeAcknowledgement(String nonce, Outcome outcome) {
        BordeauxRuntimeStatus status = revisions.status();
        ObjectNode document = MAPPER.createObjectNode();
        document.put("protocolVersion", BordeauxRobotStatusPublisher.PROTOCOL_VERSION);
        document.put("nonce", nonce);
        document.put("state", outcome.state());
        document.put("runtimeId", status.runtimeId());
        document.put("teamNumber", status.teamNumber());
        if (outcome.acknowledgement() != null) {
            BordeauxActivationAck ack = outcome.acknowledgement();
            document.put("revisionId", ack.revisionId());
            document.put("payloadSha256", ack.payloadSha256());
            document.put("catalogId", ack.catalogId());
            document.put("catalogHash", ack.catalogHash());
            document.put("supportVersion", ack.supportVersion());
            if (ack.action() != null) document.put("action", ack.action());
        } else {
            document.put("boundary", outcome.boundary());
            document.put("message", outcome.message());
        }
        try {
            return MAPPER.writeValueAsBytes(document);
        } catch (JsonProcessingException exception) {
            throw new BordeauxRuntimeException(
                    "Could not serialize Bordeaux acknowledgment", exception);
        }
    }

    private static String boundedMessage(String message) {
        String safe =
                message == null || message.isBlank() ? "Bordeaux operation was rejected" : message;
        return safe.length() <= 512 ? safe : safe.substring(0, 512);
    }

    private static void removeCandidate(Path candidate) {
        try {
            Files.delete(candidate);
        } catch (IOException exception) {
            throw new BordeauxRuntimeException(
                    "Could not remove the processed Bordeaux inbox candidate", exception);
        }
    }

    private enum Kind {
        REVISION("activation"),
        RETENTION("retention");
        private final String boundary;

        Kind(String boundary) {
            this.boundary = boundary;
        }

        private String boundary() {
            return boundary;
        }
    }

    private record Candidate(Path path, String nonce, Kind kind) {}

    private record Outcome(
            String state, BordeauxActivationAck acknowledgement, String boundary, String message) {
        private static Outcome success(String state, BordeauxActivationAck acknowledgement) {
            return new Outcome(state, Objects.requireNonNull(acknowledgement), null, null);
        }

        private static Outcome rejected(String boundary, String message) {
            return new Outcome("rejected", null, boundary, boundedMessage(message));
        }

        private boolean changed() {
            return acknowledgement != null;
        }
    }
}
