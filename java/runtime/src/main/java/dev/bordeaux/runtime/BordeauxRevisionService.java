package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/**
 * Local, opt-in activation service for fully validated Bordeaux revisions.
 *
 * <p>This service never opens a socket, watches a directory, invokes a command factory, or executes uploaded code.
 * A caller explicitly stages an envelope and explicitly calls {@link #activate(Path)} while the robot is disabled.</p>
 */
public final class BordeauxRevisionService {
    static final int MAX_REPLAY_NONCES = 2_048;
    static final int MAX_STATUS_HEALTH = 8;
    private static final int MANIFEST_VERSION = 2;
    private static final ObjectMapper MAPPER = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxNestingDepth(10)
                    .maxStringLength(512)
                    .maxNumberLength(32)
                    .build())
            .build());

    private final int teamNumber;
    private final BooleanSupplier disabled;
    private final BordeauxRuntimeCompatibility compatibility;
    private final BordeauxRevisionStorage storage;

    public BordeauxRevisionService(
            Path stateDirectory,
            int teamNumber,
            BooleanSupplier disabled,
            BordeauxRuntimeCompatibility compatibility) {
        this(stateDirectory, teamNumber, disabled, compatibility, new FileBordeauxRevisionStorage(stateDirectory));
    }

    BordeauxRevisionService(
            Path stateDirectory,
            int teamNumber,
            BooleanSupplier disabled,
            BordeauxRuntimeCompatibility compatibility,
            BordeauxRevisionStorage storage) {
        if (stateDirectory == null) throw new IllegalArgumentException("stateDirectory is required");
        if (teamNumber <= 0) throw new IllegalArgumentException("teamNumber must be positive");
        this.teamNumber = teamNumber;
        this.disabled = Objects.requireNonNull(disabled, "disabled");
        this.compatibility = Objects.requireNonNull(compatibility, "compatibility");
        this.storage = Objects.requireNonNull(storage, "storage");
    }

    /** Returns persisted identity and the exact revision selected by the current state manifest. */
    public synchronized BordeauxRuntimeStatus status() {
        return storage.withExclusiveLock(() -> status(loadOrCreateState()));
    }

    /**
     * Validates and activates one explicitly staged envelope. The active pointer is replaced atomically only after
     * the exact immutable payload is safely stored.
     */
    public synchronized BordeauxActivationAck activate(Path stagedEnvelope) {
        return activate(stagedEnvelope, null);
    }

    /**
     * Activates one explicitly staged envelope only when its nonce also matches the caller's already-bounded file
     * name. This keeps the filesystem mailbox from choosing a different activation identity than its file name.
     */
    synchronized BordeauxActivationAck activate(Path stagedEnvelope, String expectedNonce) {
        requireDisabled();
        BordeauxRevision revision = readAndValidate(stagedEnvelope);
        requireExpectedNonce(revision, expectedNonce);
        return storage.withExclusiveLock(() -> {
            requireDisabled();
            RuntimeState state = loadOrCreateState();
            if (!Objects.equals(revision.expectedActiveRevisionId(), state.activeRevisionId())) {
                throw new BordeauxRuntimeException("Revision expected active revision does not match the current active revision");
            }
            if (state.recentNonces().contains(revision.activationNonce())) {
                throw new BordeauxRuntimeException("Revision activation nonce was replayed");
            }

            storage.writeRevision(revision.revisionId(), revision.payload());
            requireDisabled();
            RuntimeState activated = state.activate(revision);
            storage.writeState(serialize(activated));
            return acknowledgement(revision, activated.runtimeId());
        });
    }

    /**
     * Reconstructs the most recent persisted activation acknowledgment when the supplied staged envelope is the
     * exact nonce-bound revision that was already activated. This lets a caller recover after its acknowledgment
     * publication failed without accepting an unrelated replay.
     */
    synchronized Optional<BordeauxActivationAck> recoverLatestAcknowledgement(Path stagedEnvelope, String expectedNonce) {
        BordeauxRevision revision = readAndValidate(stagedEnvelope);
        requireExpectedNonce(revision, expectedNonce);
        return storage.withExclusiveLock(() -> {
            RuntimeState state = loadOrCreateState();
            LatestActivation latest = state.latestActivation();
            if (latest == null || !latest.matches(revision)) return Optional.empty();
            return Optional.of(acknowledgement(latest, state.runtimeId()));
        });
    }

    /**
     * Atomically rotates the local runtime identity and clears replay/pairing state while retaining a valid active
     * revision and all immutable revision payloads.
     */
    public synchronized BordeauxRuntimeStatus resetRuntimeIdentity() {
        requireDisabled();
        return storage.withExclusiveLock(() -> {
            requireDisabled();
            RuntimeState state = loadOrCreateState();
            RuntimeState reset = state.resetIdentity();
            storage.writeState(serialize(reset));
            return status(reset);
        });
    }

    private BordeauxRevision readAndValidate(Path stagedEnvelope) {
        if (stagedEnvelope == null) throw new BordeauxRuntimeException("Staged revision envelope path is required");
        try (InputStream input = Files.newInputStream(stagedEnvelope)) {
            return BordeauxRevisionReader.validate(input, compatibility);
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not read staged Bordeaux revision envelope", exception);
        }
    }

    private void requireDisabled() {
        if (!disabled.getAsBoolean()) {
            throw new BordeauxRuntimeException("Bordeaux revision activation is allowed only while the robot is disabled");
        }
    }

    private static void requireExpectedNonce(BordeauxRevision revision, String expectedNonce) {
        if (expectedNonce != null && !expectedNonce.equals(revision.activationNonce())) {
            throw new BordeauxRuntimeException("Bordeaux revision activation nonce does not match its inbox file name");
        }
    }

    private RuntimeState loadOrCreateState() {
        Optional<byte[]> persisted = storage.readState();
        if (persisted.isPresent()) return deserialize(persisted.get());
        RuntimeState initial = RuntimeState.initial();
        storage.writeState(serialize(initial));
        return initial;
    }

    private BordeauxRuntimeStatus status(RuntimeState state) {
        List<String> health;
        if (state.activeRevisionId() == null) {
            health = List.of("ready: no active Bordeaux revision");
        } else if (storage.revisionMatches(state.activeRevisionId(), state.activePayloadSha256())) {
            health = List.of("ready: active revision " + state.activeRevisionId());
        } else {
            health = List.of("error: active revision payload is missing or corrupt");
        }
        return new BordeauxRuntimeStatus(
                state.runtimeId(), teamNumber, disabled.getAsBoolean(), compatibility.catalogId(), compatibility.catalogHash(),
                compatibility.supportVersion(), compatibility.fieldId(), compatibility.fieldRevision(),
                compatibility.fieldCoordinateSchemaId(), state.activeRevisionId(), state.activePayloadSha256(), health);
    }

    private BordeauxActivationAck acknowledgement(BordeauxRevision revision, String runtimeId) {
        return new BordeauxActivationAck(
                revision.activationNonce(), revision.revisionId(), revision.payloadSha256(), compatibility.catalogId(),
                compatibility.catalogHash(), compatibility.supportVersion(), runtimeId, teamNumber);
    }

    private static byte[] serialize(RuntimeState state) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("version", MANIFEST_VERSION);
        root.put("runtimeId", state.runtimeId());
        if (state.activeRevisionId() == null) root.putNull("activeRevisionId");
        else root.put("activeRevisionId", state.activeRevisionId());
        if (state.activePayloadSha256() == null) root.putNull("activePayloadSha256");
        else root.put("activePayloadSha256", state.activePayloadSha256());
        if (state.latestActivation() == null) {
            root.putNull("latestActivation");
        } else {
            ObjectNode latest = root.putObject("latestActivation");
            latest.put("nonce", state.latestActivation().nonce());
            latest.put("revisionId", state.latestActivation().revisionId());
            latest.put("payloadSha256", state.latestActivation().payloadSha256());
        }
        ArrayNode nonces = root.putArray("recentNonces");
        state.recentNonces().forEach(nonces::add);
        try {
            return MAPPER.writeValueAsBytes(root);
        } catch (JsonProcessingException exception) {
            throw new BordeauxRuntimeException("Could not serialize Bordeaux runtime state", exception);
        }
    }

    private static RuntimeState deserialize(byte[] contents) {
        try {
            JsonNode root = MAPPER.readTree(contents);
            if (!(root instanceof ObjectNode object)) throw invalidState("root must be an object");
            if (!object.path("version").canConvertToInt()
                    || (object.path("version").intValue() != 1 && object.path("version").intValue() != MANIFEST_VERSION)) {
                throw invalidState("version is unsupported");
            }
            int version = object.path("version").intValue();
            String runtimeId = text(object, "runtimeId");
            try {
                UUID.fromString(runtimeId);
            } catch (IllegalArgumentException exception) {
                throw invalidState("runtimeId must be a UUID");
            }
            String activeRevisionId = nullableHash(object, "activeRevisionId");
            String activePayloadSha256 = nullableHash(object, "activePayloadSha256");
            if ((activeRevisionId == null) != (activePayloadSha256 == null)) {
                throw invalidState("active revision and payload hash must both be present or null");
            }
            JsonNode nonceNode = object.get("recentNonces");
            if (!(nonceNode instanceof ArrayNode nonces) || nonces.size() > MAX_REPLAY_NONCES) {
                throw invalidState("recent nonces must be an array of at most " + MAX_REPLAY_NONCES);
            }
            LinkedHashSet<String> replay = new LinkedHashSet<>();
            for (JsonNode nonce : nonces) {
                if (!nonce.isTextual() || !nonce.textValue().matches("[A-Za-z0-9._:-]{1,256}") || !replay.add(nonce.textValue())) {
                    throw invalidState("recent nonces must be unique valid nonce strings");
                }
            }
            LatestActivation latest = version == 1 ? null : latestActivation(object.get("latestActivation"));
            if (latest != null && (!latest.revisionId().equals(activeRevisionId)
                    || !latest.payloadSha256().equals(activePayloadSha256)
                    || !replay.contains(latest.nonce()))) {
                throw invalidState("latest activation must match the active revision and replay history");
            }
            return new RuntimeState(runtimeId, activeRevisionId, activePayloadSha256, List.copyOf(replay), latest);
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException(
                    "Could not parse persisted Bordeaux runtime state: " + exception.getMessage(), exception);
        }
    }

    private static String text(ObjectNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) throw invalidState(field + " is required");
        return value.textValue();
    }

    private static String nullableHash(ObjectNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual() || !value.textValue().matches("sha256:[0-9a-f]{64}")) {
            throw invalidState(field + " must be sha256:<64 lowercase hex characters> or null");
        }
        return value.textValue();
    }

    private static LatestActivation latestActivation(JsonNode value) {
        if (value == null || value.isNull()) return null;
        if (!(value instanceof ObjectNode latest)) throw invalidState("latest activation must be an object or null");
        String nonce = text(latest, "nonce");
        if (!nonce.matches("[A-Za-z0-9._:-]{1,256}")) throw invalidState("latest activation nonce is invalid");
        String revisionId = nullableHash(latest, "revisionId");
        String payloadSha256 = nullableHash(latest, "payloadSha256");
        if (revisionId == null || payloadSha256 == null) {
            throw invalidState("latest activation revision and payload hash are required");
        }
        return new LatestActivation(nonce, revisionId, payloadSha256);
    }

    private static BordeauxRuntimeException invalidState(String detail) {
        return new BordeauxRuntimeException("Persisted Bordeaux runtime state is invalid: " + detail);
    }

    private BordeauxActivationAck acknowledgement(LatestActivation latest, String runtimeId) {
        return new BordeauxActivationAck(
                latest.nonce(), latest.revisionId(), latest.payloadSha256(), compatibility.catalogId(), compatibility.catalogHash(),
                compatibility.supportVersion(), runtimeId, teamNumber);
    }

    private record RuntimeState(
            String runtimeId,
            String activeRevisionId,
            String activePayloadSha256,
            List<String> recentNonces,
            LatestActivation latestActivation) {
        private static RuntimeState initial() {
            return new RuntimeState(UUID.randomUUID().toString(), null, null, List.of(), null);
        }

        private RuntimeState activate(BordeauxRevision revision) {
            ArrayList<String> nonces = new ArrayList<>(recentNonces);
            nonces.add(revision.activationNonce());
            if (nonces.size() > MAX_REPLAY_NONCES) nonces.remove(0);
            return new RuntimeState(
                    runtimeId, revision.revisionId(), revision.payloadSha256(), List.copyOf(nonces), LatestActivation.from(revision));
        }

        private RuntimeState resetIdentity() {
            return new RuntimeState(UUID.randomUUID().toString(), activeRevisionId, activePayloadSha256, List.of(), null);
        }
    }

    private record LatestActivation(String nonce, String revisionId, String payloadSha256) {
        private static LatestActivation from(BordeauxRevision revision) {
            return new LatestActivation(revision.activationNonce(), revision.revisionId(), revision.payloadSha256());
        }

        private boolean matches(BordeauxRevision revision) {
            return nonce.equals(revision.activationNonce())
                    && revisionId.equals(revision.revisionId())
                    && payloadSha256.equals(revision.payloadSha256());
        }
    }
}
