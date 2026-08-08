package dev.bordeaux.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import java.lang.reflect.Field;
import java.lang.reflect.GenericArrayType;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Rejects Jackson coercions before conversion, recursively following the authored Java type. */
final class StrictJson {
    private static final int MAX_DEPTH = 24;
    private static final int MAX_ARRAY_ITEMS = 1_024;
    private static final int MAX_OBJECT_FIELDS = 256;
    private static final int MAX_EXACT_CHARACTERS = 1_024;
    private static final int MAX_DECIMAL_EXPONENT = 10_000;

    private StrictJson() {}

    static void validate(JsonNode node, Type type, String path) {
        validate(node, type, path, 0);
    }

    private static void validate(JsonNode node, Type type, String path, int depth) {
        if (depth > MAX_DEPTH) fail(path, "exceeds the nesting limit of " + MAX_DEPTH);
        if (node == null || node.isNull()) fail(path, "must not be null");
        if (type instanceof GenericArrayType array) {
            array(node, array.getGenericComponentType(), path, depth);
            return;
        }
        if (type instanceof ParameterizedType parameterized) {
            if (!(parameterized.getRawType() instanceof Class<?>)) fail(path, "has an unsupported generic type");
            Class<?> raw = (Class<?>) parameterized.getRawType();
            Type[] arguments = parameterized.getActualTypeArguments();
            if (Collection.class.isAssignableFrom(raw)) {
                array(node, arguments[0], path, depth);
                return;
            }
            if (Map.class.isAssignableFrom(raw)) {
                if (arguments[0] != String.class) fail(path, "map keys must be strings");
                objectValues(node, arguments[1], path, depth);
                return;
            }
            validateClass(node, raw, path, depth);
            return;
        }
        if (!(type instanceof Class<?>)) fail(path, "has an unsupported Java type");
        Class<?> raw = (Class<?>) type;
        if (raw.isArray()) {
            array(node, raw.getComponentType(), path, depth);
            return;
        }
        validateClass(node, raw, path, depth);
    }

    private static void validateClass(JsonNode node, Class<?> raw, String path, int depth) {
        if (raw == boolean.class || raw == Boolean.class) {
            if (!node.isBoolean()) fail(path, "must be a boolean");
        } else if (raw == byte.class || raw == Byte.class) {
            integral(node, path, BigInteger.valueOf(Byte.MIN_VALUE), BigInteger.valueOf(Byte.MAX_VALUE));
        } else if (raw == short.class || raw == Short.class) {
            integral(node, path, BigInteger.valueOf(Short.MIN_VALUE), BigInteger.valueOf(Short.MAX_VALUE));
        } else if (raw == int.class || raw == Integer.class) {
            integral(node, path, BigInteger.valueOf(Integer.MIN_VALUE), BigInteger.valueOf(Integer.MAX_VALUE));
        } else if (raw == long.class || raw == Long.class) {
            exactInteger(node, path, BigInteger.valueOf(Long.MIN_VALUE), BigInteger.valueOf(Long.MAX_VALUE));
        } else if (raw == BigInteger.class) {
            exactInteger(node, path, null, null);
        } else if (raw == BigDecimal.class) {
            exactDecimal(node, path);
        } else if (raw == float.class || raw == Float.class) {
            if (!node.isNumber() || !Float.isFinite(node.floatValue())) fail(path, "must be a finite number");
        } else if (raw == double.class || raw == Double.class) {
            if (!node.isNumber() || !Double.isFinite(node.doubleValue())) fail(path, "must be a finite number");
        } else if (raw == String.class) {
            if (!node.isTextual()) fail(path, "must be a string");
        } else if (raw.isEnum()) {
            if (!node.isTextual()) fail(path, "must be an enum name");
            boolean found = false;
            for (Object constant : raw.getEnumConstants()) {
                if (((Enum<?>) constant).name().equals(node.textValue())) found = true;
            }
            if (!found) fail(path, "is not a valid " + raw.getSimpleName() + " value");
        } else if (raw.isRecord()) {
            record(node, raw, path, depth);
        } else {
            publicFields(node, raw, path, depth);
        }
    }

    private static void array(JsonNode node, Type elementType, String path, int depth) {
        if (!node.isArray()) fail(path, "must be an array");
        if (node.size() > MAX_ARRAY_ITEMS) fail(path, "exceeds the array limit of " + MAX_ARRAY_ITEMS);
        for (int index = 0; index < node.size(); index++) {
            validate(node.get(index), elementType, path + "[" + index + "]", depth + 1);
        }
    }

    private static void objectValues(JsonNode node, Type valueType, String path, int depth) {
        if (!node.isObject()) fail(path, "must be an object");
        if (node.size() > MAX_OBJECT_FIELDS) fail(path, "exceeds the object-field limit of " + MAX_OBJECT_FIELDS);
        node.fields().forEachRemaining(entry -> validate(entry.getValue(), valueType, path + "." + entry.getKey(), depth + 1));
    }

    private static void record(JsonNode node, Class<?> raw, String path, int depth) {
        Map<String, Type> fields = new HashMap<>();
        for (RecordComponent component : raw.getRecordComponents()) fields.put(component.getName(), component.getGenericType());
        objectShape(node, fields, path, depth);
    }

    private static void publicFields(JsonNode node, Class<?> raw, String path, int depth) {
        Map<String, Type> fields = new HashMap<>();
        for (Field field : raw.getDeclaredFields()) {
            int modifiers = field.getModifiers();
            if (java.lang.reflect.Modifier.isPublic(modifiers)
                    && !java.lang.reflect.Modifier.isStatic(modifiers)
                    && !java.lang.reflect.Modifier.isFinal(modifiers)) {
                fields.put(field.getName(), field.getGenericType());
            }
        }
        objectShape(node, fields, path, depth);
    }

    private static void objectShape(JsonNode node, Map<String, Type> fields, String path, int depth) {
        if (!node.isObject()) fail(path, "must be an object");
        if (node.size() > MAX_OBJECT_FIELDS) fail(path, "exceeds the object-field limit of " + MAX_OBJECT_FIELDS);
        Set<String> actual = new HashSet<>();
        node.fieldNames().forEachRemaining(actual::add);
        for (String name : actual) if (!fields.containsKey(name)) fail(path + "." + name, "is not a declared field");
        for (Map.Entry<String, Type> field : fields.entrySet()) {
            if (!actual.contains(field.getKey())) fail(path + "." + field.getKey(), "is required");
            validate(node.get(field.getKey()), field.getValue(), path + "." + field.getKey(), depth + 1);
        }
    }

    private static void integral(JsonNode node, String path, BigInteger minimum, BigInteger maximum) {
        if (!node.isIntegralNumber()) fail(path, "must be an integer number");
        BigInteger value = node.bigIntegerValue();
        if (value.compareTo(minimum) < 0 || value.compareTo(maximum) > 0) fail(path, "is outside the Java integer range");
    }

    private static void exactInteger(JsonNode node, String path, BigInteger minimum, BigInteger maximum) {
        if (!node.isTextual() || node.textValue().length() > MAX_EXACT_CHARACTERS
                || !node.textValue().matches("[+-]?\\d+")) {
            fail(path, "must be a signed digit string");
        }
        BigInteger value = new BigInteger(node.textValue());
        if ((minimum != null && value.compareTo(minimum) < 0) || (maximum != null && value.compareTo(maximum) > 0)) {
            fail(path, "is outside the Java integer range");
        }
    }

    private static void exactDecimal(JsonNode node, String path) {
        if (!node.isTextual() || node.textValue().length() > MAX_EXACT_CHARACTERS
                || !node.textValue().matches("[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?")) {
            fail(path, "must be a decimal string");
        }
        java.util.regex.Matcher exponent = java.util.regex.Pattern.compile("[eE]([+-]?\\d+)$").matcher(node.textValue());
        if (exponent.find() && new BigInteger(exponent.group(1)).abs().compareTo(BigInteger.valueOf(MAX_DECIMAL_EXPONENT)) > 0) {
            fail(path, "decimal exponent exceeds " + MAX_DECIMAL_EXPONENT);
        }
    }

    private static void fail(String path, String detail) {
        throw new BordeauxRuntimeException(path + " " + detail);
    }
}
