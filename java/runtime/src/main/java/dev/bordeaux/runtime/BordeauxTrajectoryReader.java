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

    private static final ObjectMapper MAPPER = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxNestingDepth(40)
                    .maxStringLength(MAX_BYTES)
                    .maxNumberLength(1_000)
                    .build())
            .build());

    private BordeauxTrajectoryReader() {}

    /** Selects exactly one path by stable ID, or by name when no ID matches. */
    public static BordeauxPathEvents read(InputStream input, String pathSelector) {
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
            if (pathSelector.equals(text(path, "id", "$.paths[" + index + "]"))) idMatches.add(path);
            if (pathSelector.equals(text(path, "name", "$.paths[" + index + "]"))) nameMatches.add(path);
        }
        List<JsonNode> matches = idMatches.isEmpty() ? nameMatches : idMatches;
        if (matches.isEmpty()) throw new BordeauxRuntimeException("No path matches '" + pathSelector + "'");
        if (matches.size() != 1) throw new BordeauxRuntimeException("Path selector '" + pathSelector + "' is ambiguous");
        return parsePath(matches.get(0), catalogId, catalogHash);
    }

    private static BordeauxPathEvents parsePath(JsonNode path, String catalogId, String catalogHash) {
        String id = text(path, "id", "path");
        String name = text(path, "name", "path '" + id + "'");
        double totalTimeS = nonnegativeFinite(path.get("totalTimeS"), "Path '" + id + "' totalTimeS");
        JsonNode events = path.get("events");

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
            indexed.add(new IndexedEvent(index, new BordeauxEvent(
                    eventId, eventName, timeS, fraction, commandId, objectArguments.deepCopy(), cancelNode.booleanValue())));
        }
        indexed.sort(Comparator.comparingDouble((IndexedEvent value) -> value.event().timeS())
                .thenComparingInt(IndexedEvent::index));
        return new BordeauxPathEvents(
                id, name, totalTimeS, catalogId, catalogHash, indexed.stream().map(IndexedEvent::event).toList());
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
