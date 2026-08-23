package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Strict, bounded reader for Bordeaux native Java trajectory documents and generated catalog identities. */
public final class BordeauxTrajectoryReader {
    static final int MAX_BYTES = 16 * 1024 * 1024;
    static final int MAX_PATHS = 64;
    static final int MAX_EVENTS = 2_000;
    static final int MAX_SAMPLES = 100_000;
    static final int MAX_ROUTINE_NODES = 2_000;
    static final int MAX_GENERATED_FALLBACK_NODES = 128;
    static final int MAX_GENERATED_FALLBACK_DEPTH = 8;

    private static final ObjectMapper MAPPER = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxNestingDepth(40)
                    .maxStringLength(MAX_BYTES)
                    .maxNumberLength(1_000)
                    .build())
            .build());

    private BordeauxTrajectoryReader() {}

    /**
     * Validates every exported path and every deployable routine branch against the compiled robot identity.
     * This does not create commands or select a path.
     */
    public static void validateDocument(byte[] contents, BordeauxRuntimeCompatibility compatibility) {
        if (contents == null) throw new BordeauxRuntimeException("Trajectory contents are required");
        if (compatibility == null) throw new BordeauxRuntimeException("Runtime compatibility is required");
        ObjectNode document = readDocument(contents);
        String schemaVersion = text(document, "schemaVersion", "$");
        if (!"bordeaux-trajectory/1.0".equals(schemaVersion)) {
            throw new BordeauxRuntimeException("$.schemaVersion must be exactly 'bordeaux-trajectory/1.0'");
        }
        if (!"bordeaux".equals(text(document, "generator", "$"))) {
            throw new BordeauxRuntimeException("$.generator must be exactly 'bordeaux'");
        }
        ObjectNode catalog = requireObject(document.get("catalog"), "$.catalog must be an object");
        validateCatalog(catalog, compatibility);
        ObjectNode field = requireObject(document.get("field"), "$.field must be an object");
        validateField(field, compatibility, "$.field");

            byte[] contents, String pathSelector, BordeauxRuntimeCompatibility compatibility) {
        return readValidated(copyBounded(contents), pathSelector, compatibility, false);
    }

    /** Validates the complete document and compiled robot identity before selecting its routine. */
    public static BordeauxPathEvents readWithRoutine(
            byte[] contents, String pathSelector, BordeauxRuntimeCompatibility compatibility) {
        return readValidated(copyBounded(contents), pathSelector, compatibility, true);
    }

    /** Reads at most 16 MiB, validates the complete document, then selects one path. */
    public static BordeauxPathEvents read(
            InputStream input, String pathSelector, BordeauxRuntimeCompatibility compatibility) {
        return readValidated(readBoundedContents(input), pathSelector, compatibility, false);
    }

    /** Reads at most 16 MiB, validates the complete document, then selects its routine. */
    public static BordeauxPathEvents readWithRoutine(
            InputStream input, String pathSelector, BordeauxRuntimeCompatibility compatibility) {
        return readValidated(readBoundedContents(input), pathSelector, compatibility, true);
    }

    /** Selects one path while tolerating legacy simulation-only routine nodes. */
    public static BordeauxPathEvents read(InputStream input, String pathSelector) {
        return read(input, pathSelector, false);
    }

    /** Selects one path and strictly reads its deployable between-path routine. */
    public static BordeauxPathEvents readWithRoutine(InputStream input, String pathSelector) {
        return read(input, pathSelector, true);
    }

    private static BordeauxPathEvents read(InputStream input, String pathSelector, boolean includeRoutine) {
        requireSelector(pathSelector);
        return readDocument(input, pathSelector, includeRoutine, null);
    }

    private static BordeauxPathEvents readDocument(InputStream input, String pathSelector,
            boolean includeRoutine, BordeauxRuntimeCompatibility compatibility) {
        if (input == null) throw new BordeauxRuntimeException("Trajectory input is required");
        boolean validateAll = compatibility != null;
        String schemaVersion = null;
        String generator = null;
        ObjectNode catalog = null;
        ObjectNode fieldIdentity = null;
        JsonNode routineNode = null;
        PathCandidate idMatch = null;
        PathCandidate nameMatch = null;
        int nameMatchCount = 0;
        Set<String> pathIds = new HashSet<>();
        Set<String> eventIds = new HashSet<>();
        java.util.Map<String, ObjectNode> routinePaths = new java.util.LinkedHashMap<>();
        int sampleCount = 0;
        int eventCount = 0;
        int pathCount = 0;
        boolean pathsPresent = false;
        try (JsonParser parser = MAPPER.createParser(new BoundedInputStream(input, MAX_BYTES,
                "trajectory exceeds the " + MAX_BYTES + " byte limit"))) {
            if (parser.nextToken() != JsonToken.START_OBJECT) {
                throw new BordeauxRuntimeException("$ must be a JSON object");
            }
            while (parser.nextToken() != JsonToken.END_OBJECT) {
                if (parser.currentToken() != JsonToken.FIELD_NAME) {
                    throw new BordeauxRuntimeException("$ must contain named fields");
                }
                String field = parser.currentName();
                JsonToken value = parser.nextToken();
                if (value == null) throw new BordeauxRuntimeException("Unexpected end of trajectory JSON");
                switch (field) {
                    case "schemaVersion" -> {
                        schemaVersion = value == JsonToken.VALUE_STRING ? parser.getText() : null;
                        parser.skipChildren();
                    }
                    case "generator" -> {
                        generator = value == JsonToken.VALUE_STRING ? parser.getText() : null;
                        parser.skipChildren();
                    }
                    case "catalog" -> catalog = requireObject(MAPPER.readTree(parser), "$.catalog must be an object");
                    case "field" -> {
                        if (validateAll) fieldIdentity = requireObject(MAPPER.readTree(parser), "$.field must be an object");
                        else parser.skipChildren();
                    }
                    case "routine" -> {
                        if (includeRoutine || validateAll) routineNode = MAPPER.readTree(parser);
                        else parser.skipChildren();
                    }
                    case "paths" -> {
                        pathsPresent = true;
                        if (value != JsonToken.START_ARRAY) throw new BordeauxRuntimeException("$.paths must be an array");
                        while (parser.nextToken() != JsonToken.END_ARRAY) {
                            int index = pathCount++;
                            if (pathCount > MAX_PATHS) {
                                throw new BordeauxRuntimeException("$.paths exceeds the limit of " + MAX_PATHS);
                            }
                            ObjectNode path = requireObject(MAPPER.readTree(parser),
                                    "$.paths[" + index + "] must be an object");
                            JsonNode samples = path.get("samples");
                            if (samples == null || !samples.isArray()) {
                                throw new BordeauxRuntimeException("$.paths[" + index + "].samples must be an array");
                            }
                            JsonNode events = path.get("events");
                            if (events == null || !events.isArray()) {
                                throw new BordeauxRuntimeException("$.paths[" + index + "].events must be an array");
                            }
                            sampleCount += samples.size();
                            eventCount += events.size();
                            if (sampleCount > MAX_SAMPLES) {
                                throw new BordeauxRuntimeException("Trajectory exceeds the sample limit of " + MAX_SAMPLES);
                            }
                            if (eventCount > MAX_EVENTS) {
                                throw new BordeauxRuntimeException("Trajectory exceeds the event limit of " + MAX_EVENTS);
                            }
                            if (validateAll) {
                                for (int eventIndex = 0; eventIndex < events.size(); eventIndex++) {
                                    String eventPath = "$.paths[" + index + "].events[" + eventIndex + "]";
                                    ObjectNode event = requireObject(events.get(eventIndex), eventPath + " must be an object");
                                    String eventId = text(event, "eventId", eventPath);
                                    if (!eventIds.add(eventId)) throw new BordeauxRuntimeException("Duplicate event ID '" + eventId + "'");
                                }
                            }
                            String pathId = text(path, "id", "$.paths[" + index + "]");
                            if (!pathIds.add(pathId)) throw new BordeauxRuntimeException("Duplicate path ID '" + pathId + "'");
                            // Metadata can follow paths in JSON. Parse motion once now,
                            // then attach the checked catalog and routine after the scan.
                            PathData parsed = validateAll ? parsePath(path) : null;
                            if (includeRoutine) routinePaths.put(pathId, path);
                            if (pathSelector != null) {
                                PathCandidate candidate = new PathCandidate(path, parsed);
                                if (pathSelector.equals(pathId)) idMatch = candidate;
                                if (pathSelector.equals(text(path, "name", "$.paths[" + index + "]"))) {
                                    if (nameMatch == null) nameMatch = candidate;
                                    nameMatchCount++;
                                }
                            }
                        }
                    }
                    default -> parser.skipChildren();
                }
            }
            if (parser.nextToken() != null) {
                throw new BordeauxRuntimeException("Could not parse Bordeaux trajectory JSON: trailing JSON value");
            }
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not parse Bordeaux trajectory JSON: " + exception.getMessage(), exception);
        }
        if (!"bordeaux-trajectory/1.0".equals(schemaVersion)) {
            throw new BordeauxRuntimeException("$.schemaVersion must be exactly 'bordeaux-trajectory/1.0'");
        }
        if (!"bordeaux".equals(generator)) {
            throw new BordeauxRuntimeException("$.generator must be exactly 'bordeaux'");
        }
        CatalogIdentity identity = readCatalog(requireObject(catalog, "$.catalog must be an object"), compatibility);
        if (validateAll) {
            validateField(requireObject(fieldIdentity, "$.field must be an object"), compatibility, "$.field");
            if (!pathsPresent) throw new BordeauxRuntimeException("$.paths must be an array");
        }
        if (pathCount == 0) throw new BordeauxRuntimeException("$.paths must contain at least one path");
        BordeauxRoutine routine = includeRoutine || validateAll
                ? parseRoutine(routineNode, pathIds, identity.schema()) : BordeauxRoutine.empty();
        if (pathSelector == null) return null;
        PathCandidate selected = idMatch != null ? idMatch : nameMatch;
        if (selected == null) throw new BordeauxRuntimeException("No path matches '" + pathSelector + "'");
        if (idMatch == null && nameMatchCount != 1) {
            throw new BordeauxRuntimeException("Path selector '" + pathSelector + "' is ambiguous");
        }
        PathData parsed = selected.parsed() != null ? selected.parsed() : parsePath(selected.json());
        java.util.Map<String, List<BordeauxEvent>> routineEvents = new java.util.LinkedHashMap<>();
        if (includeRoutine) {
            java.util.Deque<BordeauxRoutineNode> pending = new java.util.ArrayDeque<>(routine.nodes());
            while (!pending.isEmpty()) {
                BordeauxRoutineNode node = pending.removeFirst();
                if (node instanceof BordeauxRoutineNode.Path path && !routineEvents.containsKey(path.pathId())) {
                    routineEvents.put(path.pathId(), parsePath(routinePaths.get(path.pathId())).events());
                } else if (node instanceof BordeauxRoutineNode.Decision decision) {
                    pending.addAll(decision.whenTrue());
                    pending.addAll(decision.whenFalse());
                } else if (node instanceof BordeauxRoutineNode.GeneratedTrajectory generated
                        && generated.fallback() instanceof BordeauxRoutineNode.GeneratedFallback.Branch branch) {
                    pending.addAll(branch.nodes());
                }
            }
        }
        return new BordeauxPathEvents(parsed.id(), parsed.name(), parsed.totalTimeS(), identity.id(), identity.hash(),
                parsed.events(), parsed.samples(), parsed.followSections(), includeRoutine ? routine : BordeauxRoutine.empty(), routineEvents);
    }

    private record PathCandidate(ObjectNode json, PathData parsed) {}
    private record PathData(String id, String name, double totalTimeS, List<BordeauxEvent> events,
            List<BordeauxSample> samples, List<BordeauxFollowSection> followSections) {}
    private record CatalogIdentity(String id, String hash, String schema) {}

    private static void requireSelector(String pathSelector) {
        if (pathSelector == null || pathSelector.isBlank()) throw new BordeauxRuntimeException("A path ID or name is required");
    }

    private static PathData parsePath(JsonNode path) {
        String id = text(path, "id", "path");
        String name = text(path, "name", "path '" + id + "'");
        double totalTimeS = nonnegativeFinite(path.get("totalTimeS"), "Path '" + id + "' totalTimeS");
        JsonNode sampleNodes = path.get("samples");
        JsonNode events = path.get("events");

        List<BordeauxSample> samples = new ArrayList<>();
        for (int index = 0; index < sampleNodes.size(); index++) {
            JsonNode sample = requireObject(sampleNodes.get(index), "Path '" + id + "' sample " + index + " must be an object");
            if (!sample.path("i").canConvertToInt() || sample.path("i").intValue() != index) {
                throw new BordeauxRuntimeException("Path '" + id + "' sample indexes must be contiguous from zero");
            }
            double timeS = nonnegativeFinite(sample.get("t"), "Path '" + id + "' sample " + index + " time");
            if (!samples.isEmpty() && timeS < samples.get(samples.size() - 1).timeS() - 1e-9) {
                throw new BordeauxRuntimeException("Path '" + id + "' sample times must be monotonic");
            }
            samples.add(new BordeauxSample(index, timeS,
                    nonnegativeFinite(sample.get("s"), "Path '" + id + "' sample " + index + " distance"),
                    finiteInRange(sample.get("f"), "Path '" + id + "' sample " + index + " fraction", 0, 1),
                    finite(sample.get("x"), "Path '" + id + "' sample " + index + " X"),
                    finite(sample.get("y"), "Path '" + id + "' sample " + index + " Y"),
                    finite(sample.get("headingRad"), "Path '" + id + "' sample " + index + " heading"),
                    finite(sample.get("velocityMps"), "Path '" + id + "' sample " + index + " velocity"),
                    optionalFinite(sample.get("accelerationMps2"),
                            "Path '" + id + "' sample " + index + " acceleration", 0),
                    optionalFinite(sample.get("angularVelocityRadps"),
                            "Path '" + id + "' sample " + index + " angular velocity", 0),
                    optionalFinite(sample.get("curvatureInvM"),
                            "Path '" + id + "' sample " + index + " curvature", 0)));
        }
        applyTravelHeadings(samples);

        List<BordeauxFollowSection> sections = new ArrayList<>();
        JsonNode sectionNodes = path.get("followSections");
        if (sectionNodes == null && !samples.isEmpty()) {
            sections.add(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.TIME, 0, samples.size() - 1));
        } else if (sectionNodes != null) {
            if (!sectionNodes.isArray()) throw new BordeauxRuntimeException("Path '" + id + "' followSections must be an array");
            for (int index = 0; index < sectionNodes.size(); index++) {
                JsonNode section = requireObject(sectionNodes.get(index), "Path '" + id + "' follow section " + index + " must be an object");
                int segment = requiredInt(section.get("segmentIndex"), "Follow section " + index + " segmentIndex");
                int start = requiredInt(section.get("startSample"), "Follow section " + index + " startSample");
                int end = requiredInt(section.get("endSample"), "Follow section " + index + " endSample");
                String mode = text(section, "mode", "Follow section " + index);
                if (start < 0 || end < start || end >= samples.size()) throw new BordeauxRuntimeException("Follow section " + index + " has invalid sample bounds");
                if (index == 0 && start != 0 || index > 0 && start != sections.get(index - 1).endSample()) {
                    throw new BordeauxRuntimeException("Path '" + id + "' follow sections must be contiguous");
                }
                sections.add(new BordeauxFollowSection(segment,
                        switch (mode) { case "time" -> BordeauxFollowSection.Mode.TIME; case "position" -> BordeauxFollowSection.Mode.POSITION; default -> throw new BordeauxRuntimeException("Follow section mode must be time or position"); },
                        start, end));
            }
            if (!samples.isEmpty() && (sections.isEmpty() || sections.get(sections.size() - 1).endSample() != samples.size() - 1)) {
                throw new BordeauxRuntimeException("Path '" + id + "' follow sections must cover every sample");
            }
        }

        List<IndexedEvent> indexed = new ArrayList<>();
        Set<String> eventIds = new HashSet<>();
        java.util.Map<String, ObjectNode> routinePaths = new java.util.LinkedHashMap<>();
        for (int index = 0; index < events.size(); index++) {
            JsonNode event = requireObject(events.get(index), "Path '" + id + "' event " + index + " must be an object");
            String eventId = text(event, "eventId", "Path '" + id + "' event " + index);
            if (!eventIds.add(eventId)) {
                throw new BordeauxRuntimeException("Path '" + id + "' contains duplicate event ID '" + eventId + "'");
            }
            String eventName = text(event, "name", "Event '" + eventId + "'");
            double timeS = nonnegativeFinite(event.get("timeS"), "Event '" + eventId + "' timeS");
            double fraction = finiteInRange(event.get("fraction"), "Event '" + eventId + "' fraction", 0, 1);
            if (timeS > totalTimeS + 1e-9) {
                throw new BordeauxRuntimeException("Event '" + eventId + "' occurs after path totalTimeS");
            }
            String commandId = text(event, "commandId", "Event '" + eventId + "'");
            JsonNode arguments = event.get("arguments");
            if (!(arguments instanceof ObjectNode objectArguments)) {
                throw new BordeauxRuntimeException("Event '" + eventId + "' arguments must be an object");
            }
            JsonNode cancelNode = event.get("cancelOnPathEnd");
            if (cancelNode == null || !cancelNode.isBoolean()) {
                throw new BordeauxRuntimeException("Event '" + eventId + "' cancelOnPathEnd must be a boolean");
            }
            String triggerValue = event.has("trigger") ? text(event, "trigger", "Event '" + eventId + "'") : "time";
            BordeauxEvent.Trigger trigger = switch (triggerValue) {
                case "time" -> BordeauxEvent.Trigger.TIME;
                case "position" -> BordeauxEvent.Trigger.POSITION;
                default -> throw new BordeauxRuntimeException("Event '" + eventId + "' trigger must be time or position");
            };
            Double repeatEveryS = optionalPositiveFinite(event.get("repeatEveryS"), "Event '" + eventId + "' repeatEveryS");
            Double endTimeS = optionalNonnegativeFinite(event.get("endTimeS"), "Event '" + eventId + "' endTimeS");
            if (endTimeS != null && endTimeS < timeS) {
                throw new BordeauxRuntimeException("Event '" + eventId + "' ends before it starts");
            }
            String conditionId = event.has("conditionId") ? text(event, "conditionId", "Event '" + eventId + "'") : null;
            if (conditionId != null && !conditionId.matches("[A-Za-z0-9_.:#()$,-]{1,256}")) {
                throw new BordeauxRuntimeException("Event '" + eventId + "' conditionId is invalid");
            }
            indexed.add(new IndexedEvent(index, new BordeauxEvent(
                    eventId, eventName, timeS, fraction, commandId, objectArguments.deepCopy(), cancelNode.booleanValue(),
                    trigger, repeatEveryS, endTimeS, conditionId)));
        }
        indexed.sort(Comparator.comparingDouble((IndexedEvent value) -> value.event().timeS())
                .thenComparingInt(IndexedEvent::index));
        return new PathData(id, name, totalTimeS, indexed.stream().map(IndexedEvent::event).toList(), samples, sections);
    }

    private static BordeauxRoutine parseRoutine(JsonNode value, Set<String> pathIds, String catalogSchema) {
        if (value == null || value.isNull()) return BordeauxRoutine.empty();
        ObjectNode routine = requireObject(value, "$.routine must be an object or null");
        String name = text(routine, "name", "$.routine");
        JsonNode nodes = routine.get("nodes");
        if (nodes == null || !nodes.isArray()) throw new BordeauxRuntimeException("$.routine.nodes must be an array");
        return new BordeauxRoutine(name, parseRoutineNodes(nodes, "$.routine.nodes", pathIds, new HashSet<>(), new int[] {0}, catalogSchema));
    }

    private static List<BordeauxRoutineNode> parseRoutineNodes(JsonNode nodes, String path,
            Set<String> pathIds, Set<String> nodeIds, int[] count, String catalogSchema) {
        List<BordeauxRoutineNode> parsed = new ArrayList<>();
        for (int index = 0; index < nodes.size(); index++) {
            if (++count[0] > MAX_ROUTINE_NODES) throw new BordeauxRuntimeException("Routine exceeds the node limit of " + MAX_ROUTINE_NODES);
            String base = path + "[" + index + "]";
            ObjectNode node = requireObject(nodes.get(index), base + " must be an object");
            String id = text(node, "id", base);
            if (!nodeIds.add(id)) throw new BordeauxRuntimeException("Routine contains duplicate node ID '" + id + "'");
            String type = text(node, "type", base);
            if ("path".equals(type)) {
                String ref = text(node, "ref", base);
                if (!pathIds.contains(ref)) throw new BordeauxRuntimeException(base + ".ref does not match an exported path ID");
                parsed.add(new BordeauxRoutineNode.Path(id, ref));
            } else if ("decision".equals(type)) {
                String condition = text(node, "cond", base);
                if (!condition.matches("[A-Za-z0-9_.:#()$,-]{1,256}")) throw new BordeauxRuntimeException(base + ".cond must be a stable condition ID");
                JsonNode whenTrue = node.get("then");
                JsonNode whenFalse = node.get("else");
                if (whenTrue == null || !whenTrue.isArray() || whenFalse == null || !whenFalse.isArray()) {
                    throw new BordeauxRuntimeException(base + " decision branches must be arrays");
                }
                parsed.add(new BordeauxRoutineNode.Decision(id, condition,
                        parseRoutineNodes(whenTrue, base + ".then", pathIds, nodeIds, count, catalogSchema),
                        parseRoutineNodes(whenFalse, base + ".else", pathIds, nodeIds, count, catalogSchema)));
            } else if ("function".equals(type) && "command".equals(text(node, "cat", base))) {
                ObjectNode invocation = requireObject(node.get("invocation"), base + ".invocation must be an object");
                ObjectNode arguments = requireObject(invocation.get("arguments"), base + ".invocation.arguments must be an object");
                parsed.add(new BordeauxRoutineNode.Command(id, text(invocation, "commandId", base + ".invocation"), arguments));
            } else if ("builtin".equals(type)) {
                if (!("1.2".equals(catalogSchema) || "1.3".equals(catalogSchema))) {
                    throw new BordeauxRuntimeException(base + " built-ins require catalog schema 1.2 or later");
                }
                String builtInId = text(node, "builtinId", base);
                if (!"bordeaux.wait".equals(builtInId)) {
                    throw new BordeauxRuntimeException(base + ".builtinId must be the supported built-in 'bordeaux.wait'");
                }
                ObjectNode arguments = requireObject(node.get("arguments"), base + ".arguments must be an object");
                if (arguments.size() != 1 || !arguments.has("durationS")) {
                    throw new BordeauxRuntimeException(base + ".arguments must contain exactly durationS");
                }
                double durationS = finite(arguments.get("durationS"), base + ".arguments.durationS");
                if (durationS < 0.02 || durationS > 15) {
                    throw new BordeauxRuntimeException(base + ".arguments.durationS must be between 0.02 and 15 seconds");
                }
                parsed.add(new BordeauxRoutineNode.Wait(id, durationS));
            } else if ("generatedTrajectory".equals(type)) {
                if (!"1.3".equals(catalogSchema)) {
                    throw new BordeauxRuntimeException(base + " generated trajectories require catalog schema 1.3");
                }
                requireExactFields(node, Set.of("id", "type", "generatorId", "arguments", "fallback"), base);
                String generatorId = text(node, "generatorId", base);
                if (!generatorId.matches("[A-Za-z0-9_.:#()$,-]{1,256}")) {
                    throw new BordeauxRuntimeException(base + ".generatorId must be a stable generator ID");
                }
                ObjectNode arguments = requireObject(node.get("arguments"), base + ".arguments must be an object");
                parsed.add(new BordeauxRoutineNode.GeneratedTrajectory(id, generatorId, arguments,
                        parseGeneratedFallback(node.get("fallback"), base + ".fallback", pathIds, nodeIds)));
            } else {
                throw new BordeauxRuntimeException(base + " must be a path, decision, bound command, supported built-in, or generated trajectory");
            }
        }
        return parsed;
    }

    private static BordeauxRoutineNode.GeneratedFallback parseGeneratedFallback(
            JsonNode value, String path, Set<String> pathIds, Set<String> nodeIds) {
        ObjectNode fallback = requireObject(value, path + " must be an object");
        String type = text(fallback, "type", path);
        if ("safeStop".equals(type)) {
            requireExactFields(fallback, Set.of("type"), path);
            return new BordeauxRoutineNode.GeneratedFallback.SafeStop();
        }
        if (!"branch".equals(type)) {
            throw new BordeauxRuntimeException(path + ".type must be safeStop or branch");
        }
        requireExactFields(fallback, Set.of("type", "nodes"), path);
        JsonNode nodes = fallback.get("nodes");
        if (nodes == null || !nodes.isArray()) throw new BordeauxRuntimeException(path + ".nodes must be an array");
        List<BordeauxRoutineNode> parsed = parseFallbackNodes(nodes, path + ".nodes", pathIds, nodeIds, new int[] {0}, 0);
        if (!reachesStaticPath(parsed)) {
            throw new BordeauxRuntimeException(path + " every root-to-leaf branch must reach a static path");
        }
        return new BordeauxRoutineNode.GeneratedFallback.Branch(parsed);
    }

    private static List<BordeauxRoutineNode> parseFallbackNodes(JsonNode nodes, String path,
            Set<String> pathIds, Set<String> nodeIds, int[] count, int depth) {
        List<BordeauxRoutineNode> parsed = new ArrayList<>();
        for (int index = 0; index < nodes.size(); index++) {
            if (++count[0] > MAX_GENERATED_FALLBACK_NODES) {
                throw new BordeauxRuntimeException(path + " exceeds the fallback node limit of " + MAX_GENERATED_FALLBACK_NODES);
            }
            String base = path + "[" + index + "]";
            ObjectNode node = requireObject(nodes.get(index), base + " must be an object");
            String id = text(node, "id", base);
            if (!nodeIds.add(id)) throw new BordeauxRuntimeException("Routine contains duplicate node ID '" + id + "'");
            String type = text(node, "type", base);
            switch (type) {
                case "path" -> {
                    requireExactFields(node, Set.of("id", "type", "ref"), base);
                    String ref = text(node, "ref", base);
                    if (!pathIds.contains(ref)) throw new BordeauxRuntimeException(base + ".ref does not match an exported path ID");
                    parsed.add(new BordeauxRoutineNode.Path(id, ref));
                }
                case "decision" -> {
                    if (depth >= MAX_GENERATED_FALLBACK_DEPTH) {
                        throw new BordeauxRuntimeException(base + " exceeds the fallback decision depth of " + MAX_GENERATED_FALLBACK_DEPTH);
                    }
                    requireAllowedFields(node, Set.of("id", "type", "cond", "thenLabel", "elseLabel", "then", "else"), base);
                    optionalBoundedText(node, "thenLabel", base, 256);
                    optionalBoundedText(node, "elseLabel", base, 256);
                    String condition = text(node, "cond", base);
                    if (!condition.matches("[A-Za-z0-9_.:#()$,-]{1,256}")) {
                        throw new BordeauxRuntimeException(base + ".cond must be a stable condition ID");
                    }
                    JsonNode whenTrue = node.get("then");
                    JsonNode whenFalse = node.get("else");
                    if (whenTrue == null || !whenTrue.isArray() || whenFalse == null || !whenFalse.isArray()) {
                        throw new BordeauxRuntimeException(base + " decision branches must be arrays");
                    }
                    parsed.add(new BordeauxRoutineNode.Decision(id, condition,
                            parseFallbackNodes(whenTrue, base + ".then", pathIds, nodeIds, count, depth + 1),
                            parseFallbackNodes(whenFalse, base + ".else", pathIds, nodeIds, count, depth + 1)));
                }
                case "function" -> {
                    requireAllowedFields(node, Set.of("id", "type", "cat", "title", "invocation"), base);
                    optionalBoundedText(node, "title", base, 256);
                    if (!"command".equals(text(node, "cat", base))) {
                        throw new BordeauxRuntimeException(base + ".cat must be command");
                    }
                    ObjectNode invocation = requireObject(node.get("invocation"), base + ".invocation must be an object");
                    requireExactFields(invocation, Set.of("commandId", "arguments"), base + ".invocation");
                    ObjectNode arguments = requireObject(invocation.get("arguments"), base + ".invocation.arguments must be an object");
                    parsed.add(new BordeauxRoutineNode.Command(id, text(invocation, "commandId", base + ".invocation"), arguments));
                }
                case "builtin" -> {
                    requireExactFields(node, Set.of("id", "type", "builtinId", "arguments"), base);
                    if (!"bordeaux.wait".equals(text(node, "builtinId", base))) {
                        throw new BordeauxRuntimeException(base + ".builtinId must be bordeaux.wait");
                    }
                    ObjectNode arguments = requireObject(node.get("arguments"), base + ".arguments must be an object");
                    requireExactFields(arguments, Set.of("durationS"), base + ".arguments");
                    double durationS = finite(arguments.get("durationS"), base + ".arguments.durationS");
                    if (durationS < 0.02 || durationS > 15) {
                        throw new BordeauxRuntimeException(base + ".arguments.durationS must be between 0.02 and 15 seconds");
                    }
                    parsed.add(new BordeauxRoutineNode.Wait(id, durationS));
                }
                case "generatedTrajectory" -> throw new BordeauxRuntimeException(base + " must not contain a nested generated trajectory");
                default -> throw new BordeauxRuntimeException(base + " must contain only deployable fallback nodes");
            }
        }
        return parsed;
    }

    private static boolean reachesStaticPath(List<BordeauxRoutineNode> nodes) {
        for (int index = 0; index < nodes.size(); index++) {
            BordeauxRoutineNode node = nodes.get(index);
            if (node instanceof BordeauxRoutineNode.Path) return true;
            if (node instanceof BordeauxRoutineNode.Decision decision) {
                List<BordeauxRoutineNode> suffix = nodes.subList(index + 1, nodes.size());
                if (!reachesStaticPath(withSuffix(decision.whenTrue(), suffix))
                        || !reachesStaticPath(withSuffix(decision.whenFalse(), suffix))) return false;
                return true;
            }
        }
        return false;
    }

    private static List<BordeauxRoutineNode> withSuffix(
            List<BordeauxRoutineNode> branch, List<BordeauxRoutineNode> suffix) {
        List<BordeauxRoutineNode> combined = new ArrayList<>(branch.size() + suffix.size());
        combined.addAll(branch);
        combined.addAll(suffix);
        return combined;
    }

    private static void requireExactFields(ObjectNode node, Set<String> fields, String path) {
        Set<String> actual = new HashSet<>();
        node.fieldNames().forEachRemaining(actual::add);
        if (!actual.equals(fields)) throw new BordeauxRuntimeException(path + " must contain exactly " + fields);
    }

    private static void requireAllowedFields(ObjectNode node, Set<String> fields, String path) {
        node.fieldNames().forEachRemaining(field -> {
            if (!fields.contains(field)) throw new BordeauxRuntimeException(path + " contains unsupported field '" + field + "'");
        });
    }

    private static void optionalBoundedText(ObjectNode node, String field, String path, int maximumLength) {
        JsonNode value = node.get(field);
        if (value != null && (!value.isTextual() || value.textValue().length() > maximumLength)) {
            throw new BordeauxRuntimeException(path + "." + field + " must be a string of at most " + maximumLength + " characters");
        }
    }

    private static byte[] readBoundedContents(InputStream input) {
        if (input == null) throw new BordeauxRuntimeException("Trajectory input is required");
        try {
            return new BoundedInputStream(input, MAX_BYTES, "trajectory exceeds the " + MAX_BYTES + " byte limit").readAllBytes();
        } catch (IOException exception) {
            throw new BordeauxRuntimeException(
                    "Could not read Bordeaux trajectory JSON: " + exception.getMessage(), exception);
        }
    }

    private static byte[] copyBounded(byte[] contents) {
        if (contents == null) throw new BordeauxRuntimeException("Trajectory contents are required");
        if (contents.length > MAX_BYTES) {
            throw new BordeauxRuntimeException("trajectory exceeds the " + MAX_BYTES + " byte limit");
        }
        return contents.clone();
    }

    private static BordeauxPathEvents readValidated(byte[] contents, String pathSelector,
            BordeauxRuntimeCompatibility compatibility, boolean includeRoutine) {
        if (compatibility == null) throw new BordeauxRuntimeException("Runtime compatibility is required");
        requireSelector(pathSelector);
        return readDocument(new ByteArrayInputStream(contents), pathSelector, includeRoutine, compatibility);
    }

    private static CatalogIdentity readCatalog(ObjectNode catalog, BordeauxRuntimeCompatibility compatibility) {
        String schemaVersion = text(catalog, "schemaVersion", "$.catalog");
        String supportVersion = text(catalog, "supportVersion", "$.catalog");
        if (compatibility != null) {
            String expectedSchema = catalogSchema(compatibility.supportVersion());
            if (expectedSchema == null) {
                throw new BordeauxRuntimeException("Compiled Bordeaux support version is not supported: " + compatibility.supportVersion());
            }
            if (!expectedSchema.equals(schemaVersion) || !compatibility.supportVersion().equals(supportVersion)) {
                throw new BordeauxRuntimeException("$.catalog must exactly match compiled schema/support "
                        + expectedSchema + "/" + compatibility.supportVersion());
            }
        } else if (!schemaVersion.equals(catalogSchema(supportVersion))) {
            throw new BordeauxRuntimeException("$.catalog must use a supported schema/support pair from 1.0/0.1.0 through 1.3/0.4.0");
        }
        String catalogId = text(catalog, "catalogId", "$.catalog");
        if (catalogId.length() > 256) throw new BordeauxRuntimeException("$.catalog.catalogId exceeds 256 characters");
        String catalogHash = text(catalog, "catalogHash", "$.catalog");
        if (!catalogHash.matches("sha256:[0-9a-f]{64}")) {
            throw new BordeauxRuntimeException("$.catalog.catalogHash must use sha256:<64 lowercase hex characters>");
        }
        if (compatibility != null) {
            if (!compatibility.catalogId().equals(catalogId)) {
                throw new BordeauxRuntimeException("Trajectory catalog ID does not match the compiled robot catalog");
            }
            if (!compatibility.catalogHash().equals(catalogHash)) {
                throw new BordeauxRuntimeException("Trajectory catalog hash does not match the compiled robot catalog");
            }
        }
        return new CatalogIdentity(catalogId, catalogHash, schemaVersion);
    }

    private static String catalogSchema(String supportVersion) {
        return switch (supportVersion) {
            case "0.1.0" -> "1.0";
            case "0.2.0" -> "1.1";
            case "0.3.0" -> "1.2";
            case "0.4.0" -> "1.3";
            default -> null;
        };
    }

    private static void validateField(ObjectNode field, BordeauxRuntimeCompatibility compatibility, String path) {
        if (!compatibility.fieldId().equals(text(field, "id", path))) {
            throw new BordeauxRuntimeException("Trajectory field ID does not match the compiled robot field");
        }
        if (!compatibility.fieldRevision().equals(text(field, "revision", path))) {
            throw new BordeauxRuntimeException("Trajectory field revision does not match the compiled robot field");
        }
        if (!compatibility.fieldCoordinateSchemaId().equals(text(field, "coordinateSchemaId", path))) {
            throw new BordeauxRuntimeException("Trajectory field coordinate schema does not match the compiled robot field");
        }
    }

    private static ObjectNode requireObject(JsonNode node, String message) {
        if (!(node instanceof ObjectNode object)) throw new BordeauxRuntimeException(message);
        return object;
    }

    private static String text(JsonNode owner, String field, String context) {
        JsonNode value = owner.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw new BordeauxRuntimeException(context + "." + field + " must be a nonempty string");
        }
        return value.textValue();
    }

    private static double nonnegativeFinite(JsonNode value, String context) {
        if (value == null || !value.isNumber()) throw new BordeauxRuntimeException(context + " must be a number");
        double result = value.doubleValue();
        if (!Double.isFinite(result) || result < 0) {
            throw new BordeauxRuntimeException(context + " must be finite and nonnegative");
        }
        return result;
    }

    private static double finite(JsonNode value, String context) {
        if (value == null || !value.isNumber() || !Double.isFinite(value.doubleValue())) {
            throw new BordeauxRuntimeException(context + " must be a finite number");
        }
        return value.doubleValue();
    }

    private static Double optionalPositiveFinite(JsonNode value, String context) {
        if (value == null) return null;
        double result = finite(value, context);
        if (result < 0.001) throw new BordeauxRuntimeException(context + " must be at least 0.001 seconds");
        return result;
    }

    private static Double optionalNonnegativeFinite(JsonNode value, String context) {
        if (value == null) return null;
        return nonnegativeFinite(value, context);
    }

    private static double optionalFinite(JsonNode value, String context, double defaultValue) {
        return value == null ? defaultValue : finite(value, context);
    }

    private static void applyTravelHeadings(List<BordeauxSample> samples) {
        for (int index = 0; index < samples.size(); index++) {
            BordeauxSample sample = samples.get(index);
            double travelHeadingRad = travelHeading(samples, index);
            samples.set(index, new BordeauxSample(sample.index(), sample.timeS(), sample.distanceM(),
                    sample.fraction(), sample.xM(), sample.yM(), sample.headingRad(), sample.velocityMps(),
                    sample.accelerationMps2(), sample.angularVelocityRadps(), sample.curvatureInvM(),
                    travelHeadingRad));
        }
    }

    private static double travelHeading(List<BordeauxSample> samples, int index) {
        BordeauxSample sample = samples.get(index);
        int before = Math.max(0, index - 1);
        int after = Math.min(samples.size() - 1, index + 1);
        double dx = samples.get(after).xM() - samples.get(before).xM();
        double dy = samples.get(after).yM() - samples.get(before).yM();
        if (Math.hypot(dx, dy) <= 1e-9 && index + 1 < samples.size()) {
            dx = samples.get(index + 1).xM() - sample.xM();
            dy = samples.get(index + 1).yM() - sample.yM();
        }
        if (Math.hypot(dx, dy) <= 1e-9 && index > 0) {
            dx = sample.xM() - samples.get(index - 1).xM();
            dy = sample.yM() - samples.get(index - 1).yM();
        }
        return Math.hypot(dx, dy) <= 1e-9 ? sample.headingRad() : Math.atan2(dy, dx);
    }

    private static int requiredInt(JsonNode value, String context) {
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < 0) {
            throw new BordeauxRuntimeException(context + " must be a nonnegative integer");
        }
        return value.intValue();
    }

    private static double finiteInRange(JsonNode value, String context, double minimum, double maximum) {
        if (value == null || !value.isNumber()) throw new BordeauxRuntimeException(context + " must be a number");
        double result = value.doubleValue();
        if (!Double.isFinite(result) || result < minimum || result > maximum) {
            throw new BordeauxRuntimeException(context + " must be finite and between " + minimum + " and " + maximum);
        }
        return result;
    }

    private record IndexedEvent(int index, BordeauxEvent event) {}

}
