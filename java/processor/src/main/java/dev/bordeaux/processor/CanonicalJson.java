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
        return fields;
    }

    private String array() {
        return "[" + String.join(",", arrayEntries()) + "]";
    }

    private List<String> arrayEntries() {
        if (!take('[')) fail("expected an array");
        whitespace();
        if (take(']')) return List.of();
        List<String> values = new ArrayList<>();
        while (true) {
            values.add(value());
            whitespace();
            if (take(']')) break;
            if (!take(',')) fail("expected ',' or ']'");
        }
        return values;
    }

    private String string() {
        index++;
        StringBuilder result = new StringBuilder();
        while (index < input.length()) {
            char ch = input.charAt(index++);
            if (ch == '"') return result.toString();
            if (ch == '\\') {
                if (index >= input.length()) fail("unfinished escape");
                char escape = input.charAt(index++);
                switch (escape) {
                    case '"', '\\', '/' -> result.append(escape);
                    case 'b' -> result.append('\b');
                    case 'f' -> result.append('\f');
                    case 'n' -> result.append('\n');
                    case 'r' -> result.append('\r');
                    case 't' -> result.append('\t');
                    case 'u' -> {
                        if (index + 4 > input.length()) fail("bad unicode escape");
                        int code = 0;
                        for (int count = 0; count < 4; count++) {
                            int digit = Character.digit(input.charAt(index++), 16);
                            if (digit < 0) fail("bad unicode escape");
                            code = code * 16 + digit;
                        }
                        result.append((char) code);
                    }
                    default -> fail("bad escape");
                }
            } else {
                if (ch < 0x20) fail("control character in string");
                result.append(ch);
            }
        }
        fail("unfinished string");
        return "";
    }

    private String number() {
        int start = index;
        take('-');
        if (take('0')) {
            if (index < input.length() && Character.isDigit(input.charAt(index))) fail("leading zero in number");
        } else {
            digits();
        }
        if (take('.')) digits();
        if (take('e') || take('E')) {
            if (!take('+')) take('-');
            digits();
        }
        String token = input.substring(start, index);
        double value;
        try {
            value = Double.parseDouble(token);
        } catch (NumberFormatException exception) {
            fail("invalid number");
            return "";
        }
        if (!Double.isFinite(value)) fail("number must be finite");
        if (value == 0) return "0";
        BigDecimal decimal = BigDecimal.valueOf(value).stripTrailingZeros();
        double absolute = Math.abs(value);
        if (absolute >= 1e-6 && absolute < 1e21) return decimal.toPlainString();
        String digits = decimal.unscaledValue().abs().toString();
        int exponent = digits.length() - 1 - decimal.scale();
        String coefficient = digits.length() == 1 ? digits : digits.charAt(0) + "." + digits.substring(1);
        return (value < 0 ? "-" : "") + coefficient + "e" + (exponent >= 0 ? "+" : "") + exponent;
    }

