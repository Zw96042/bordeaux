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
