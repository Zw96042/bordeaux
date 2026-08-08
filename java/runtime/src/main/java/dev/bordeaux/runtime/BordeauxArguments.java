package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Optional;
import java.util.Set;

/** Typed, checked access to one invocation's JSON arguments. */
public final class BordeauxArguments {
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.USE_BIG_INTEGER_FOR_INTS)
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

    private final String commandId;
    private final ObjectNode values;

    BordeauxArguments(String commandId, ObjectNode values) {
        this.commandId = commandId;
        this.values = values;
    }

    public <T> T require(String name, TypeReference<T> type) {
        JsonNode node = requiredNode(name);
        if (node.isNull()) throw error(name, "must not be null");
        return convert(name, node, type);
    }

    public <T> Optional<T> optional(String name, TypeReference<T> type) {
        JsonNode node = values.get(name);
        if (node == null || node.isNull()) return Optional.empty();
        return Optional.ofNullable(convert(name, node, type));
    }

    public long requireLong(String name) {
        JsonNode node = requiredNode(name);
        StrictJson.validate(node, long.class, "Command '" + commandId + "' argument '" + name + "'");
        try {
            if (node.isTextual()) return Long.parseLong(node.textValue());
        } catch (ArithmeticException | NumberFormatException ignored) {
            // The common error below is clearer and includes the command and parameter.
        }
        throw error(name, "must be a signed 64-bit integer encoded as a decimal string");
    }

    public long requireLong(String name, String minimum, String maximum) {
        long value = requireLong(name);
        assertRange(name, BigDecimal.valueOf(value), minimum, maximum);
        return value;
    }

    public BigInteger requireBigInteger(String name) {
        JsonNode node = requiredNode(name);
        StrictJson.validate(node, BigInteger.class, "Command '" + commandId + "' argument '" + name + "'");
        try {
            if (node.isTextual()) return new BigInteger(node.textValue());
        } catch (NumberFormatException ignored) {
            // Fall through to a contextual error.
        }
        throw error(name, "must be an integer encoded as a decimal string");
    }

    public BigInteger requireBigInteger(String name, String minimum, String maximum) {
        BigInteger value = requireBigInteger(name);
        assertRange(name, new BigDecimal(value), minimum, maximum);
        return value;
    }

    public BigDecimal requireBigDecimal(String name) {
        JsonNode node = requiredNode(name);
        StrictJson.validate(node, BigDecimal.class, "Command '" + commandId + "' argument '" + name + "'");
        try {
            if (node.isTextual()) return new BigDecimal(node.textValue());
        } catch (NumberFormatException ignored) {
            // Fall through to a contextual error.
        }
        throw error(name, "must be a decimal encoded as a string");
    }

    public BigDecimal requireBigDecimal(String name, String minimum, String maximum) {
        BigDecimal value = requireBigDecimal(name);
        assertRange(name, value, minimum, maximum);
        return value;
    }

    public double requireDouble(String name) {
        Double value = require(name, new TypeReference<Double>() {});
        if (!Double.isFinite(value)) throw error(name, "must be finite");
        return value;
    }

    public double requireDouble(String name, String minimum, String maximum) {
        double value = requireDouble(name);
        assertRange(name, BigDecimal.valueOf(value), minimum, maximum);
        return value;
    }

    public float requireFloat(String name) {
        Float value = require(name, new TypeReference<Float>() {});
        if (!Float.isFinite(value)) throw error(name, "must be finite");
        return value;
    }

    public float requireFloat(String name, String minimum, String maximum) {
        float value = requireFloat(name);
        assertRange(name, new BigDecimal(Float.toString(value)), minimum, maximum);
        return value;
    }

    public <T extends Number> T requireNumber(
            String name, TypeReference<T> type, String minimum, String maximum) {
        T value = require(name, type);
        assertRange(name, new BigDecimal(value.toString()), minimum, maximum);
        return value;
    }

    void assertOnly(Set<String> expected) {
        values.fieldNames().forEachRemaining(name -> {
            if (!expected.contains(name)) {
                throw error(name, "is not a declared parameter");
            }
        });
    }

    private JsonNode requiredNode(String name) {
        JsonNode node = values.get(name);
        if (node == null) throw error(name, "is required");
        return node;
    }

    private <T> T convert(String name, JsonNode node, TypeReference<T> type) {
        try {
            StrictJson.validate(node, type.getType(), "Command '" + commandId + "' argument '" + name + "'");
            return MAPPER.readerFor(type).readValue(node);
        } catch (Exception exception) {
            throw new BordeauxRuntimeException(
                    "Command '" + commandId + "' argument '" + name + "' is invalid: " + safeMessage(exception),
                    exception);
        }
    }

    private BordeauxRuntimeException error(String name, String detail) {
        return new BordeauxRuntimeException("Command '" + commandId + "' argument '" + name + "' " + detail);
    }

    private void assertRange(String name, BigDecimal value, String minimum, String maximum) {
        if (minimum != null && value.compareTo(new BigDecimal(minimum)) < 0) {
            throw error(name, "must be at least " + minimum);
        }
        if (maximum != null && value.compareTo(new BigDecimal(maximum)) > 0) {
            throw error(name, "must be at most " + maximum);
        }
    }

    private static String safeMessage(Exception exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) return exception.getClass().getSimpleName();
        int newline = message.indexOf('\n');
        return newline >= 0 ? message.substring(0, newline) : message;
    }
}
