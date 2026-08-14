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
    private static final int MANIFEST_VERSION = 1;
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
        requireDisabled();
        BordeauxRevision revision = readAndValidate(stagedEnvelope);
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
            if (!object.path("version").canConvertToInt() || object.path("version").intValue() != MANIFEST_VERSION) {
                throw invalidState("version is unsupported");
            }
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
            return new RuntimeState(runtimeId, activeRevisionId, activePayloadSha256, List.copyOf(replay));
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

    private static BordeauxRuntimeException invalidState(String detail) {
        return new BordeauxRuntimeException("Persisted Bordeaux runtime state is invalid: " + detail);
    }

    private record RuntimeState(
            String runtimeId, String activeRevisionId, String activePayloadSha256, List<String> recentNonces) {
        private static RuntimeState initial() {
            return new RuntimeState(UUID.randomUUID().toString(), null, null, List.of());
        }

        private RuntimeState activate(BordeauxRevision revision) {
            ArrayList<String> nonces = new ArrayList<>(recentNonces);
            nonces.add(revision.activationNonce());
            if (nonces.size() > MAX_REPLAY_NONCES) nonces.remove(0);
            return new RuntimeState(runtimeId, revision.revisionId(), revision.payloadSha256(), List.copyOf(nonces));
        }

        private RuntimeState resetIdentity() {
            return new RuntimeState(UUID.randomUUID().toString(), activeRevisionId, activePayloadSha256, List.of());
        }
    }
}
