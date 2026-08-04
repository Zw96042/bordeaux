package dev.bordeaux.processor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Dependency-free JSON parser/canonicalizer matching the app's semantic hash input. */
final class CanonicalJson {
    private final String input;
    private int index;

    private CanonicalJson(String input) {
        this.input = input;
    }

    static String canonicalize(String input) {
        CanonicalJson parser = new CanonicalJson(input);
        String result = parser.value();
        parser.whitespace();
        if (parser.index != input.length()) parser.fail("unexpected trailing text");
        return result;
    }

    static List<String> arrayValues(String input) {
        CanonicalJson parser = new CanonicalJson(input);
        parser.whitespace();
        List<String> values = parser.arrayEntries();
        parser.whitespace();
        if (parser.index != input.length()) parser.fail("unexpected trailing text");
        return values;
    }

    static Map<String, String> objectValues(String input) {
        CanonicalJson parser = new CanonicalJson(input);
        parser.whitespace();
        Map<String, String> values = parser.objectEntries();
        parser.whitespace();
        if (parser.index != input.length()) parser.fail("unexpected trailing text");
        return values;
    }

    static String stringValue(String input) {
        CanonicalJson parser = new CanonicalJson(input);
        parser.whitespace();
        if (parser.index >= input.length() || input.charAt(parser.index) != '"') parser.fail("expected a string");
        String value = parser.string();
        parser.whitespace();
        if (parser.index != input.length()) parser.fail("unexpected trailing text");
        return value;
    }

    private String value() {
        whitespace();
        if (index >= input.length()) fail("expected a value");
        return switch (input.charAt(index)) {
            case '"' -> quote(string());
            case '{' -> object();
            case '[' -> array();
            case 't' -> literal("true");
            case 'f' -> literal("false");
            case 'n' -> literal("null");
            default -> number();
        };
    }

    private String object() {
        Map<String, String> fields = objectEntries();
        return "{" + fields.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .map(entry -> quote(entry.getKey()) + ":" + entry.getValue())
                .reduce((left, right) -> left + "," + right).orElse("") + "}";
    }

    private Map<String, String> objectEntries() {
        if (!take('{')) fail("expected an object");
        whitespace();
        if (take('}')) return Map.of();
        Map<String, String> fields = new LinkedHashMap<>();
        while (true) {
            whitespace();
            if (index >= input.length() || input.charAt(index) != '"') fail("expected an object key");
            String key = string();
            whitespace();
            if (!take(':')) fail("expected ':'");
            if (fields.putIfAbsent(key, value()) != null) fail("duplicate object key '" + key + "'");
            whitespace();
            if (take('}')) break;
            if (!take(',')) fail("expected ',' or '}'");
        }
