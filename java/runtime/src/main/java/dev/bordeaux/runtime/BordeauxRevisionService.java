package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonProcessingException;
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
 * Local, opt-in activation and bounded-retention service for fully validated Bordeaux revisions. It
 * does not own a transport: callers stage bounded files and invoke an operation while disabled.
 */
public final class BordeauxRevisionService {
    static final int MAX_REPLAY_NONCES = 2_048;
    static final int MAX_STATUS_HEALTH = 8;
    static final int RECENT_LIMIT = 5;
    private static final int MANIFEST_VERSION = 3;
    private static final ObjectMapper MAPPER =
            new ObjectMapper(
                    JsonFactory.builder()
                            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                            .streamReadConstraints(
                                    StreamReadConstraints.builder()
                                            .maxNestingDepth(12)
                                            .maxStringLength(512)
                                            .maxNumberLength(32)
                                            .build())
                            .build());

    private final int teamNumber;
    private final BooleanSupplier disabled;
    private final BordeauxRuntimeCompatibility compatibility;
    private final BordeauxRevisionStorage storage;
    private String cleanupWarning;

    public BordeauxRevisionService(
            Path stateDirectory,
            int teamNumber,
            BooleanSupplier disabled,
            BordeauxRuntimeCompatibility compatibility) {
        this(
                stateDirectory,
                teamNumber,
                disabled,
                compatibility,
                new FileBordeauxRevisionStorage(stateDirectory));
    }

    BordeauxRevisionService(
            Path stateDirectory,
            int teamNumber,
            BooleanSupplier disabled,
            BordeauxRuntimeCompatibility compatibility,
            BordeauxRevisionStorage storage) {
        if (stateDirectory == null)
            throw new IllegalArgumentException("stateDirectory is required");
        if (teamNumber <= 0) throw new IllegalArgumentException("teamNumber must be positive");
        this.teamNumber = teamNumber;
        this.disabled = Objects.requireNonNull(disabled, "disabled");
        this.compatibility = Objects.requireNonNull(compatibility, "compatibility");
        this.storage = Objects.requireNonNull(storage, "storage");
    }

    public synchronized BordeauxRuntimeStatus status() {
        return storage.withExclusiveLock(() -> status(loadOrCreateState()));
    }

    public synchronized BordeauxActivationAck activate(Path stagedEnvelope) {
        return activate(stagedEnvelope, null);
    }

    synchronized BordeauxActivationAck activate(Path stagedEnvelope, String expectedNonce) {
        requireDisabled();
        BordeauxRevision revision = readAndValidate(stagedEnvelope);
        requireExpectedNonce(revision.activationNonce(), expectedNonce);
        return storage.withExclusiveLock(
                () -> {
                    requireDisabled();
                    RuntimeState prior = loadOrCreateState();
                    requireExpectedActive(revision.expectedActiveRevisionId(), prior);
                    requireFreshNonce(revision.activationNonce(), prior);
                    storage.writeRevision(revision.revisionId(), revision.payload());
                    requireDisabled();
                    RuntimeState next = prior.push(revision);
                    storage.writeState(serialize(next));
                    cleanupReleased(prior, next);
                    return acknowledgement(next.latestAction(), next.runtimeId());
                });
    }

    synchronized BordeauxActivationAck applyRetention(Path stagedControl, String expectedNonce) {
        requireDisabled();
        BordeauxRetentionControl control = readRetention(stagedControl);
        requireExpectedNonce(control.nonce(), expectedNonce);
        return storage.withExclusiveLock(
                () -> {
                    requireDisabled();
                    RuntimeState prior = loadOrCreateState();
                    requireExpectedActive(control.expectedActiveRevisionId(), prior);
                    requireFreshNonce(control.nonce(), prior);
                    RevisionRef target =
                            new RevisionRef(control.revisionId(), control.payloadSha256());
                    if (!prior.tracked().contains(target)) {
                        throw new BordeauxRuntimeException(
                                "Retention target is not a known retained Bordeaux revision");
                    }
                    byte[] payload =
                            storage.readRevision(target.revisionId(), target.payloadSha256());
                    BordeauxTrajectoryReader.validateDocument(payload, compatibility);
                    if (!target.revisionId()
                            .equals(
                                    BordeauxRevisionReader.revisionIdForPayload(
                                            payload, compatibility))) {
                        throw new BordeauxRuntimeException(
                                "Retained Bordeaux revision metadata does not match its payload");
                    }
                    requireDisabled();
                    RuntimeState next =
                            control.action().equals("rollback")
                                    ? prior.rollback(control.nonce(), target)
                                    : prior.pin(control.nonce(), target);
                    storage.writeState(serialize(next));
                    cleanupReleased(prior, next);
                    return acknowledgement(next.latestAction(), next.runtimeId());
                });
    }

    synchronized Optional<BordeauxActivationAck> recoverLatestAcknowledgement(
            Path stagedEnvelope, String expectedNonce) {
        BordeauxRevision revision = readAndValidate(stagedEnvelope);
        requireExpectedNonce(revision.activationNonce(), expectedNonce);
        return storage.withExclusiveLock(
                () -> {
                    LatestAction latest = loadOrCreateState().latestAction();
                    return latest != null
                                    && latest.matches(
                                            "push",
                                            revision.activationNonce(),
                                            revision.revisionId(),
                                            revision.payloadSha256())
                            ? Optional.of(acknowledgement(latest, loadOrCreateState().runtimeId()))
                            : Optional.empty();
                });
    }

    synchronized Optional<BordeauxActivationAck> recoverRetentionAcknowledgement(
            Path stagedControl, String expectedNonce) {
        BordeauxRetentionControl control = readRetention(stagedControl);
        requireExpectedNonce(control.nonce(), expectedNonce);
        return storage.withExclusiveLock(
                () -> {
                    RuntimeState state = loadOrCreateState();
                    LatestAction latest = state.latestAction();
                    return latest != null
                                    && latest.matches(
                                            control.action(),
                                            control.nonce(),
                                            control.revisionId(),
                                            control.payloadSha256())
                            ? Optional.of(acknowledgement(latest, state.runtimeId()))
                            : Optional.empty();
                });
    }

    public synchronized BordeauxRuntimeStatus resetRuntimeIdentity() {
        requireDisabled();
        return storage.withExclusiveLock(
                () -> {
                    requireDisabled();
                    RuntimeState state = loadOrCreateState();
                    RuntimeState reset = state.resetIdentity();
                    storage.writeState(serialize(reset));
                    return status(reset);
                });
    }

    boolean isDisabled() {
        return disabled.getAsBoolean();
    }

    private BordeauxRevision readAndValidate(Path path) {
        if (path == null)
            throw new BordeauxRuntimeException("Staged revision envelope path is required");
        try (InputStream input = Files.newInputStream(path)) {
            return BordeauxRevisionReader.validate(input, compatibility);
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException(
                    "Could not read staged Bordeaux revision envelope", exception);
        }
    }

    private BordeauxRetentionControl readRetention(Path path) {
        if (path == null)
            throw new BordeauxRuntimeException("Staged retention control path is required");
        try (InputStream input = Files.newInputStream(path)) {
            return BordeauxRetentionControl.read(input);
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException(
                    "Could not read staged Bordeaux retention control", exception);
        }
    }

    private void cleanupReleased(RuntimeState prior, RuntimeState next) {
        for (RevisionRef released : prior.tracked()) {
            if (next.tracked().contains(released)) continue;
            try {
                storage.deleteRevision(released.revisionId());
            } catch (BordeauxRuntimeException exception) {
                cleanupWarning = "warning: retained revision cleanup incomplete";
            }
        }
    }

    private BordeauxRuntimeStatus status(RuntimeState state) {
        List<String> health = new ArrayList<>();
        boolean activeRetained = state.active() != null
                && storage.revisionMatches(state.active().revisionId(), state.active().payloadSha256());
        if (state.active() == null) health.add("ready: no active Bordeaux revision");
        else if (activeRetained) health.add("ready: active revision " + state.active().revisionId());
        else health.add("error: active revision payload is missing or corrupt");
        if (cleanupWarning != null) health.add(cleanupWarning);
        List<BordeauxRevisionRetention.Entry> retained = new ArrayList<>();
        for (RevisionRef ref : state.tracked()) {
            boolean available = ref.equals(state.active()) ? activeRetained : storage.revisionPresent(ref.revisionId());
            retained.add(new BordeauxRevisionRetention.Entry(
                    ref.revisionId(), ref.payloadSha256(), available ? "retained" : "missing", ref.equals(state.pinned())));
        }
        return new BordeauxRuntimeStatus(
                state.runtimeId(),
                teamNumber,
                disabled.getAsBoolean(),
                compatibility.catalogId(),
                compatibility.catalogHash(),
                compatibility.supportVersion(),
                compatibility.fieldId(),
                compatibility.fieldRevision(),
                compatibility.fieldCoordinateSchemaId(),
                state.active() == null ? null : state.active().revisionId(),
                state.active() == null ? null : state.active().payloadSha256(),
                List.copyOf(health),
                new BordeauxRevisionRetention(RECENT_LIMIT, retained));
    }

    private BordeauxActivationAck acknowledgement(LatestAction action, String runtimeId) {
        return new BordeauxActivationAck(
                action.nonce(),
                action.revisionId(),
                action.payloadSha256(),
                compatibility.catalogId(),
                compatibility.catalogHash(),
                compatibility.supportVersion(),
                runtimeId,
                teamNumber,
                action.action().equals("push") ? null : action.action());
    }

    private RuntimeState loadOrCreateState() {
        Optional<byte[]> persisted = storage.readState();
        if (persisted.isPresent()) return deserialize(persisted.get());
        RuntimeState initial = RuntimeState.initial();
        storage.writeState(serialize(initial));
        return initial;
    }

    private static void requireExpectedNonce(String actual, String expected) {
        if (expected != null && !expected.equals(actual)) {
            throw new BordeauxRuntimeException(
                    "Bordeaux mailbox nonce does not match its inbox file name");
        }
    }

    private void requireDisabled() {
        if (!disabled.getAsBoolean())
            throw new BordeauxRuntimeException(
                    "Bordeaux revision activation is allowed only while the robot is disabled");
    }

    private static void requireExpectedActive(String expected, RuntimeState state) {
        String active = state.active() == null ? null : state.active().revisionId();
        if (!Objects.equals(expected, active)) {
            throw new BordeauxRuntimeException(
                    "Revision expected active revision does not match the current active revision");
        }
    }

    private static void requireFreshNonce(String nonce, RuntimeState state) {
        if (state.recentNonces().contains(nonce))
            throw new BordeauxRuntimeException("Bordeaux mailbox nonce was replayed");
    }

    private static byte[] serialize(RuntimeState state) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("version", MANIFEST_VERSION);
        root.put("runtimeId", state.runtimeId());
        putRef(root, "active", state.active());
        putRef(root, "pinned", state.pinned());
        ArrayNode recent = root.putArray("recentAccepted");
        state.recentAccepted()
                .forEach(
                        ref ->
                                recent.addObject()
                                        .put("revisionId", ref.revisionId())
                                        .put("payloadSha256", ref.payloadSha256()));
        if (state.latestAction() == null) root.putNull("latestAction");
        else
            root.putObject("latestAction")
                    .put("action", state.latestAction().action())
                    .put("nonce", state.latestAction().nonce())
                    .put("revisionId", state.latestAction().revisionId())
                    .put("payloadSha256", state.latestAction().payloadSha256());
        ArrayNode nonces = root.putArray("recentNonces");
        state.recentNonces().forEach(nonces::add);
        try {
            return MAPPER.writeValueAsBytes(root);
        } catch (JsonProcessingException exception) {
            throw new BordeauxRuntimeException(
                    "Could not serialize Bordeaux runtime state", exception);
        }
    }

    private static void putRef(ObjectNode root, String name, RevisionRef ref) {
        if (ref == null) root.putNull(name);
        else
            root.putObject(name)
                    .put("revisionId", ref.revisionId())
                    .put("payloadSha256", ref.payloadSha256());
    }

    private static RuntimeState deserialize(byte[] contents) {
        try {
            JsonNode node = MAPPER.readTree(contents);
            if (!(node instanceof ObjectNode root)) throw invalidState("root must be an object");
            int version =
                    root.path("version").canConvertToInt() ? root.path("version").intValue() : -1;
            if (version < 1 || version > MANIFEST_VERSION)
                throw invalidState("version is unsupported");
            String runtimeId = text(root, "runtimeId");
            try {
                UUID.fromString(runtimeId);
            } catch (IllegalArgumentException exception) {
                throw invalidState("runtimeId must be a UUID");
            }
            if (version < 3) return migrateLegacy(root, version, runtimeId);
            RevisionRef active = ref(root.get("active"), "active");
            RevisionRef pinned = ref(root.get("pinned"), "pinned");
            List<RevisionRef> recent =
                    refs(root.get("recentAccepted"), "recentAccepted", RECENT_LIMIT);
            List<String> nonces = nonces(root.get("recentNonces"));
            LatestAction latest = latest(root.get("latestAction"));
            RuntimeState state =
                    new RuntimeState(runtimeId, active, recent, pinned, nonces, latest);
            state.validate();
            return state;
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException(
                    "Could not parse persisted Bordeaux runtime state: " + exception.getMessage(),
                    exception);
        }
    }

    private static RuntimeState migrateLegacy(ObjectNode root, int version, String runtimeId) {
        RevisionRef active = legacyRef(root);
        List<String> nonces = nonces(root.get("recentNonces"));
        LatestAction latest = null;
        if (version == 2) {
            JsonNode old = root.get("latestActivation");
            if (old != null && !old.isNull()) {
                if (!(old instanceof ObjectNode activation)) {
                    throw invalidState("latest activation must be an object or null");
                }
                String nonce = text(activation, "nonce");
                RevisionRef ref =
                        new RevisionRef(
                                nullableHash(activation, "revisionId"),
                                nullableHash(activation, "payloadSha256"));
                latest = new LatestAction("push", nonce, ref.revisionId(), ref.payloadSha256());
            }
        }
        RuntimeState state =
                new RuntimeState(
                        runtimeId,
                        active,
                        active == null ? List.of() : List.of(active),
                        null,
                        nonces,
                        latest);
        state.validate();
        return state;
    }

    private static RevisionRef legacyRef(ObjectNode root) {
        String id = nullableHash(root, "activeRevisionId");
        String payload = nullableHash(root, "activePayloadSha256");
        if ((id == null) != (payload == null))
            throw invalidState("active revision and payload hash must both be present or null");
        return id == null ? null : new RevisionRef(id, payload);
    }

    private static RevisionRef ref(JsonNode node, String name) {
        if (node == null || node.isNull()) return null;
        if (!(node instanceof ObjectNode object))
            throw invalidState(name + " must be an object or null");
        if (object.size() != 2
                || object.get("revisionId") == null
                || object.get("payloadSha256") == null)
            throw invalidState(name + " has invalid fields");
        return new RevisionRef(
                nullableHash(object, "revisionId"), nullableHash(object, "payloadSha256"));
    }

    private static List<RevisionRef> refs(JsonNode node, String name, int max) {
        if (!(node instanceof ArrayNode array) || array.size() > max)
            throw invalidState(name + " must be a bounded array");
        ArrayList<RevisionRef> values = new ArrayList<>();
        for (JsonNode value : array) {
            RevisionRef ref = ref(value, name + " entry");
            if (ref == null || values.contains(ref)) throw invalidState(name + " must be distinct");
            values.add(ref);
        }
        return List.copyOf(values);
    }

    private static List<String> nonces(JsonNode node) {
        if (!(node instanceof ArrayNode array) || array.size() > MAX_REPLAY_NONCES)
            throw invalidState("recent nonces must be bounded");
        LinkedHashSet<String> values = new LinkedHashSet<>();
        for (JsonNode value : array)
            if (!value.isTextual()
                    || !value.textValue().matches("[A-Za-z0-9._:-]{1,256}")
                    || !values.add(value.textValue()))
                throw invalidState("recent nonces are invalid");
        return List.copyOf(values);
    }

    private static LatestAction latest(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (!(node instanceof ObjectNode value) || value.size() != 4)
            throw invalidState("latest action is invalid");
        return new LatestAction(
                text(value, "action"),
                text(value, "nonce"),
                nullableHash(value, "revisionId"),
                nullableHash(value, "payloadSha256"));
    }

    private static String text(ObjectNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank())
            throw invalidState(field + " is required");
        return value.textValue();
    }

    private static String nullableHash(ObjectNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual() || !value.textValue().matches("sha256:[0-9a-f]{64}"))
            throw invalidState(field + " must be a SHA-256 hash or null");
        return value.textValue();
    }

    private static BordeauxRuntimeException invalidState(String detail) {
        return new BordeauxRuntimeException(
                "Persisted Bordeaux runtime state is invalid: " + detail);
    }

    private record RevisionRef(String revisionId, String payloadSha256) {
        private RevisionRef {
            if (revisionId == null
                    || payloadSha256 == null
                    || !revisionId.matches("sha256:[0-9a-f]{64}")
                    || !payloadSha256.matches("sha256:[0-9a-f]{64}"))
                throw invalidState("revision metadata is invalid");
        }
    }

    private record LatestAction(
            String action, String nonce, String revisionId, String payloadSha256) {
        private LatestAction {
            if (!List.of("push", "rollback", "pin").contains(action)
                    || nonce == null
                    || !nonce.matches("[A-Za-z0-9._:-]{1,256}"))
                throw invalidState("latest action is invalid");
            new RevisionRef(revisionId, payloadSha256);
        }

        private boolean matches(
                String candidateAction,
                String candidateNonce,
                String candidateRevision,
                String candidatePayload) {
            return action.equals(candidateAction)
                    && nonce.equals(candidateNonce)
                    && revisionId.equals(candidateRevision)
                    && payloadSha256.equals(candidatePayload);
        }
    }

    private record RuntimeState(
            String runtimeId,
            RevisionRef active,
            List<RevisionRef> recentAccepted,
            RevisionRef pinned,
            List<String> recentNonces,
            LatestAction latestAction) {
        private static RuntimeState initial() {
            return new RuntimeState(
                    UUID.randomUUID().toString(), null, List.of(), null, List.of(), null);
        }

        private void validate() {
            if (recentAccepted.size() > RECENT_LIMIT
                    || new LinkedHashSet<>(recentAccepted).size() != recentAccepted.size())
                throw invalidState("recent accepted revisions are invalid");
            if (active != null && !recentAccepted.contains(active))
                throw invalidState("active revision must be retained");
            if (latestAction != null
                    && (!recentNonces.contains(latestAction.nonce())
                            || !tracked()
                                    .contains(
                                            new RevisionRef(
                                                    latestAction.revisionId(),
                                                    latestAction.payloadSha256()))))
                throw invalidState("latest action must be tracked and replay-protected");
        }

        private RuntimeState push(BordeauxRevision revision) {
            RevisionRef target = new RevisionRef(revision.revisionId(), revision.payloadSha256());
            return next("push", revision.activationNonce(), target, target, pinned);
        }

        private RuntimeState rollback(String nonce, RevisionRef target) {
            return next("rollback", nonce, target, target, pinned);
        }

        private RuntimeState pin(String nonce, RevisionRef target) {
            ArrayList<String> nonces = new ArrayList<>(recentNonces);
            nonces.add(nonce);
            if (nonces.size() > MAX_REPLAY_NONCES) nonces.remove(0);
            return new RuntimeState(
                    runtimeId,
                    active,
                    recentAccepted,
                    target,
                    List.copyOf(nonces),
                    new LatestAction("pin", nonce, target.revisionId(), target.payloadSha256()));
        }

        private RuntimeState next(
                String action,
                String nonce,
                RevisionRef activeTarget,
                RevisionRef moved,
                RevisionRef nextPinned) {
            ArrayList<RevisionRef> recent = new ArrayList<>();
            recent.add(moved);
            for (RevisionRef ref : recentAccepted)
                if (!ref.equals(moved) && recent.size() < RECENT_LIMIT) recent.add(ref);
            ArrayList<String> nonces = new ArrayList<>(recentNonces);
            nonces.add(nonce);
            if (nonces.size() > MAX_REPLAY_NONCES) nonces.remove(0);
            return new RuntimeState(
                    runtimeId,
                    activeTarget,
                    List.copyOf(recent),
                    nextPinned,
                    List.copyOf(nonces),
                    new LatestAction(action, nonce, moved.revisionId(), moved.payloadSha256()));
        }

        private RuntimeState resetIdentity() {
            return new RuntimeState(
                    UUID.randomUUID().toString(), active, recentAccepted, pinned, List.of(), null);
        }

        private List<RevisionRef> tracked() {
            LinkedHashSet<RevisionRef> refs = new LinkedHashSet<>(recentAccepted);
            if (active != null) refs.add(active);
            if (pinned != null) refs.add(pinned);
            return List.copyOf(refs);
        }
    }
}
