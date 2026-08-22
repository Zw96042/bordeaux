package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/** Strict, bounded mailbox instruction for retention actions. */
record BordeauxRetentionControl(
    String action,
    String nonce,
    String expectedActiveRevisionId,
    String revisionId,
    String payloadSha256) {
  static final int MAX_BYTES = 16 * 1024;
  private static final ObjectMapper MAPPER =
      new ObjectMapper(
          JsonFactory.builder()
              .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
              .streamReadConstraints(
                  StreamReadConstraints.builder()
                      .maxNestingDepth(6)
                      .maxStringLength(512)
                      .maxNumberLength(32)
                      .build())
              .build());

  BordeauxRetentionControl {
    if (!"rollback".equals(action) && !"pin".equals(action)) {
      throw invalid("action is invalid");
    }
    if (nonce == null || !nonce.matches("[A-Za-z0-9._:-]{1,128}")) {
      throw invalid("nonce is invalid");
    }
    if (expectedActiveRevisionId != null)
      hash(expectedActiveRevisionId, "expectedActiveRevisionId");
    hash(revisionId, "target.revisionId");
    hash(payloadSha256, "target.payloadSha256");
  }

  static BordeauxRetentionControl read(InputStream input) {
    try (InputStream bounded = new BoundedInputStream(input);
        JsonParser parser = MAPPER.createParser(bounded)) {
      if (parser.nextToken() != JsonToken.START_OBJECT) {
        throw invalid("root must be an object");
      }
      JsonNode tree = MAPPER.readTree(parser);
      if (parser.nextToken() != null) {
        throw invalid("trailing JSON value is not allowed");
      }
      if (!(tree instanceof ObjectNode root)) throw invalid("root must be an object");
      exact(
          root,
          Set.of("protocolVersion", "action", "nonce", "expectedActiveRevisionId", "target"),
          "root");
      if (!"bordeaux-retention/1.0".equals(text(root, "protocolVersion", "root"))) {
        throw invalid("protocolVersion must be exactly bordeaux-retention/1.0");
      }
      String action = text(root, "action", "root");
      String nonce = text(root, "nonce", "root");
      JsonNode expected = root.get("expectedActiveRevisionId");
      if (expected == null || !(expected.isNull() || expected.isTextual())) {
        throw invalid("expectedActiveRevisionId is invalid");
      }
      String expectedActive = expected.isNull() ? null : expected.textValue();
      JsonNode targetNode = root.get("target");
      if (!(targetNode instanceof ObjectNode target)) throw invalid("target must be an object");
      exact(target, Set.of("revisionId", "payloadSha256"), "target");
      return new BordeauxRetentionControl(
          action,
          nonce,
          expectedActive,
          text(target, "revisionId", "target"),
          text(target, "payloadSha256", "target"));
    } catch (BordeauxRuntimeException exception) {
      throw exception;
    } catch (IOException exception) {
      throw new BordeauxRuntimeException(
          "Could not parse Bordeaux retention control: " + exception.getMessage(), exception);
    }
  }

  private static void exact(ObjectNode object, Set<String> names, String context) {
    if (object.size() != names.size()) {
      throw invalid(context + " has unsupported or missing fields");
    }
    Iterator<Map.Entry<String, JsonNode>> fields = object.fields();
    while (fields.hasNext()) {
      if (!names.contains(fields.next().getKey())) {
        throw invalid(context + " has unsupported or missing fields");
      }
    }
  }

  private static String text(ObjectNode object, String field, String context) {
    JsonNode node = object.get(field);
    if (node == null || !node.isTextual() || node.textValue().isBlank()) {
      throw invalid(context + "." + field + " is required");
    }
    return node.textValue();
  }

  private static void hash(String value, String name) {
    if (value == null || !value.matches("sha256:[0-9a-f]{64}")) {
      throw invalid(name + " must be a SHA-256 hash");
    }
  }

  private static BordeauxRuntimeException invalid(String detail) {
    return new BordeauxRuntimeException("Bordeaux retention control is invalid: " + detail);
  }

  private static final class BoundedInputStream extends InputStream {
    private final InputStream delegate;
    private int count;

    private BoundedInputStream(InputStream delegate) {
      this.delegate = delegate;
    }

    @Override
    public int read() throws IOException {
      int value = delegate.read();
      if (value >= 0) add(1);
      return value;
    }

    @Override
    public int read(byte[] bytes, int offset, int length) throws IOException {
      int read = delegate.read(bytes, offset, length);
      if (read > 0) add(read);
      return read;
    }
}
