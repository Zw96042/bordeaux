package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Strict, bounded reader for Bordeaux native Java trajectory schema 1.0. */
public final class BordeauxTrajectoryReader {
    static final int MAX_BYTES = 64 * 1024 * 1024;
    static final int MAX_PATHS = 128;
    static final int MAX_EVENTS = 10_000;
    static final int MAX_SAMPLES = 1_000_000;
    static final int MAX_ROUTINE_NODES = 10_000;

    private static final ObjectMapper MAPPER = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxNestingDepth(40)
                    .maxStringLength(MAX_BYTES)
                    .maxNumberLength(1_000)
                    .build())
            .build());

    private BordeauxTrajectoryReader() {}

    /** Selects one path while tolerating legacy simulation-only routine nodes. */
    public static BordeauxPathEvents read(InputStream input, String pathSelector) {
        return read(input, pathSelector, false);
    }

    /** Selects one path and strictly reads its deployable between-path routine. */
    public static BordeauxPathEvents readWithRoutine(InputStream input, String pathSelector) {
        return read(input, pathSelector, true);
    }

    private static BordeauxPathEvents read(InputStream input, String pathSelector, boolean includeRoutine) {
        if (input == null) throw new BordeauxRuntimeException("Trajectory input is required");
        if (pathSelector == null || pathSelector.isBlank()) {
            throw new BordeauxRuntimeException("A path ID or name is required");
        }
        JsonNode root;
        try (JsonParser parser = MAPPER.createParser(new BoundedInputStream(input, MAX_BYTES))) {
            root = MAPPER.readTree(parser);
            if (parser.nextToken() != null) {
                throw new BordeauxRuntimeException("Could not parse Bordeaux trajectory JSON: trailing JSON value");
            }
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not parse Bordeaux trajectory JSON: " + exception.getMessage(), exception);
        }
        requireObject(root, "$ must be a JSON object");
        if (!"bordeaux-trajectory/1.0".equals(text(root, "schemaVersion", "$"))) {
            throw new BordeauxRuntimeException("$.schemaVersion must be exactly 'bordeaux-trajectory/1.0'");
        }
        if (!"bordeaux".equals(text(root, "generator", "$"))) {
            throw new BordeauxRuntimeException("$.generator must be exactly 'bordeaux'");
        }
        ObjectNode catalog = requireObject(root.get("catalog"), "$.catalog must be an object");
        if (!"1.0".equals(text(catalog, "schemaVersion", "$.catalog"))) {
            throw new BordeauxRuntimeException("$.catalog.schemaVersion must be exactly '1.0'");
        }
        if (!"0.1.0".equals(text(catalog, "supportVersion", "$.catalog"))) {
            throw new BordeauxRuntimeException("$.catalog.supportVersion is not supported; expected '0.1.0'");
        }
        String catalogId = text(catalog, "catalogId", "$.catalog");
        if (catalogId.length() > 256) {
            throw new BordeauxRuntimeException("$.catalog.catalogId exceeds 256 characters");
        }
        String catalogHash = text(catalog, "catalogHash", "$.catalog");
        if (!catalogHash.matches("sha256:[0-9a-f]{64}")) {
            throw new BordeauxRuntimeException("$.catalog.catalogHash must use sha256:<64 lowercase hex characters>");
        }
        JsonNode paths = root.get("paths");
        if (paths == null || !paths.isArray()) throw new BordeauxRuntimeException("$.paths must be an array");
        if (paths.isEmpty()) throw new BordeauxRuntimeException("$.paths must contain at least one path");
        if (paths.size() > MAX_PATHS) throw new BordeauxRuntimeException("$.paths exceeds the limit of " + MAX_PATHS);

        List<JsonNode> idMatches = new ArrayList<>();
        List<JsonNode> nameMatches = new ArrayList<>();
        Set<String> pathIds = new HashSet<>();
        int sampleCount = 0;
        int eventCount = 0;
        for (int index = 0; index < paths.size(); index++) {
            JsonNode path = requireObject(paths.get(index), "$.paths[" + index + "] must be an object");
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
            if (sampleCount > MAX_SAMPLES) throw new BordeauxRuntimeException("Trajectory exceeds the sample limit of " + MAX_SAMPLES);
            if (eventCount > MAX_EVENTS) throw new BordeauxRuntimeException("Trajectory exceeds the event limit of " + MAX_EVENTS);
            String pathId = text(path, "id", "$.paths[" + index + "]");
            if (!pathIds.add(pathId)) throw new BordeauxRuntimeException("Duplicate path ID '" + pathId + "'");
            if (pathSelector.equals(pathId)) idMatches.add(path);
            if (pathSelector.equals(text(path, "name", "$.paths[" + index + "]"))) nameMatches.add(path);
        }
        List<JsonNode> matches = idMatches.isEmpty() ? nameMatches : idMatches;
        if (matches.isEmpty()) throw new BordeauxRuntimeException("No path matches '" + pathSelector + "'");
        if (matches.size() != 1) throw new BordeauxRuntimeException("Path selector '" + pathSelector + "' is ambiguous");
        BordeauxRoutine routine = includeRoutine ? parseRoutine(root.get("routine"), pathIds) : BordeauxRoutine.empty();
        return parsePath(matches.get(0), catalogId, catalogHash, routine);
    }

    private static BordeauxPathEvents parsePath(JsonNode path, String catalogId, String catalogHash, BordeauxRoutine routine) {
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
                    finite(sample.get("velocityMps"), "Path '" + id + "' sample " + index + " velocity")));
        }

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
        return new BordeauxPathEvents(
                id, name, totalTimeS, catalogId, catalogHash, indexed.stream().map(IndexedEvent::event).toList(), samples, sections, routine);
    }

    private static BordeauxRoutine parseRoutine(JsonNode value, Set<String> pathIds) {
        if (value == null || value.isNull()) return BordeauxRoutine.empty();
        ObjectNode routine = requireObject(value, "$.routine must be an object or null");
        String name = text(routine, "name", "$.routine");
        JsonNode nodes = routine.get("nodes");
        if (nodes == null || !nodes.isArray()) throw new BordeauxRuntimeException("$.routine.nodes must be an array");
        return new BordeauxRoutine(name, parseRoutineNodes(nodes, "$.routine.nodes", pathIds, new HashSet<>(), new int[] {0}));
    }

    private static List<BordeauxRoutineNode> parseRoutineNodes(JsonNode nodes, String path,
            Set<String> pathIds, Set<String> nodeIds, int[] count) {
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
                        parseRoutineNodes(whenTrue, base + ".then", pathIds, nodeIds, count),
                        parseRoutineNodes(whenFalse, base + ".else", pathIds, nodeIds, count)));
            } else if ("function".equals(type) && "command".equals(text(node, "cat", base))) {
                ObjectNode invocation = requireObject(node.get("invocation"), base + ".invocation must be an object");
                ObjectNode arguments = requireObject(invocation.get("arguments"), base + ".invocation.arguments must be an object");
                parsed.add(new BordeauxRoutineNode.Command(id, text(invocation, "commandId", base + ".invocation"), arguments));
            } else {
                throw new BordeauxRuntimeException(base + " must be a path, decision, or bound command");
            }
        }
        return parsed;
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

    private static final class BoundedInputStream extends InputStream {
        private final InputStream delegate;
        private final long maxBytes;
        private long read;

        private BoundedInputStream(InputStream delegate, long maxBytes) {
            this.delegate = delegate;
            this.maxBytes = maxBytes;
        }

        @Override
        public int read() throws IOException {
            int value = delegate.read();
            if (value >= 0) add(1);
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = delegate.read(buffer, offset, length);
            if (count > 0) add(count);
            return count;
        }

        private void add(long count) throws IOException {
            read += count;
            if (read > maxBytes) throw new IOException("trajectory exceeds the " + maxBytes + " byte limit");
        }
    }
}
