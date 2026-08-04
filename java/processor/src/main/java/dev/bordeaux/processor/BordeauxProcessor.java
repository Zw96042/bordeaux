package dev.bordeaux.processor;

import dev.bordeaux.annotations.BordeauxCommand;
import dev.bordeaux.annotations.BordeauxParam;
import java.io.IOException;
import java.io.Writer;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.annotation.processing.AbstractProcessor;
import javax.annotation.processing.Filer;
import javax.annotation.processing.RoundEnvironment;
import javax.annotation.processing.SupportedOptions;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.Modifier;
import javax.lang.model.element.TypeElement;
import javax.lang.model.element.VariableElement;
import javax.lang.model.type.ArrayType;
import javax.lang.model.type.DeclaredType;
import javax.lang.model.type.TypeKind;
import javax.lang.model.type.TypeMirror;
import javax.lang.model.util.Elements;
import javax.lang.model.util.Types;
import javax.tools.Diagnostic;
import javax.tools.JavaFileObject;
import javax.tools.StandardLocation;

/** Aggregates Bordeaux command annotations into a data catalog and direct-call registry bindings. */
@SupportedOptions("bordeaux.catalogId")
public final class BordeauxProcessor extends AbstractProcessor {
    private static final String COMMAND_TYPE = "edu.wpi.first.wpilibj2.command.Command";
    private static final String GENERATED_PACKAGE = "dev.bordeaux.generated";
    private static final String GENERATED_CLASS = "BordeauxGeneratedBindings";
    private static final int MAX_SCHEMA_DEPTH = 24;
    private static final int MAX_COMMANDS = 5_000;
    private static final int MAX_PARAMETERS = 256;
    private static final int MAX_OBJECT_FIELDS = 256;
    private static final int MAX_ENUM_VALUES = 1_024;
    private static final int MAX_CATALOG_BYTES = 2 * 1024 * 1024;
    private final List<CommandMethod> collectedMethods = new ArrayList<>();
    private final Map<String, ExecutableElement> collectedIds = new HashMap<>();
    private boolean generated;
    private boolean invalid;

    @Override
    public Set<String> getSupportedAnnotationTypes() {
        return Set.of(BordeauxCommand.class.getCanonicalName(), BordeauxParam.class.getCanonicalName());
    }

    @Override
    public SourceVersion getSupportedSourceVersion() {
        return SourceVersion.RELEASE_17;
    }

    @Override
    public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnvironment) {
        if (generated) return false;
        if (roundEnvironment.processingOver()) {
            generated = true;
            if (invalid || collectedMethods.isEmpty()) return false;
            List<CommandMethod> methods = collectedMethods.stream()
                    .sorted(Comparator.comparing(CommandMethod::id)).toList();
            try {
                String commandsJson = commandsJson(methods);
                if (commandsJson.getBytes(StandardCharsets.UTF_8).length > MAX_CATALOG_BYTES - 1_024) {
                    processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                            "Generated Bordeaux command catalog exceeds " + MAX_CATALOG_BYTES + " bytes");
                    return true;
                }
                String catalogHash = semanticHash(commandsJson);
                String catalogId = catalogId(methods);
                if (catalogId == null) return true;
                writeCatalog(commandsJson, catalogId, catalogHash);
                writeBindings(methods, catalogId, catalogHash);
            } catch (IOException exception) {
                processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                        "Could not generate Bordeaux command metadata: " + exception.getMessage());
            }
            return true;
        }
        Set<? extends Element> annotated = roundEnvironment.getElementsAnnotatedWith(BordeauxCommand.class);
        if (annotated.isEmpty()) return false;
        if (collectedMethods.size() + annotated.size() > MAX_COMMANDS) {
            processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                    "Bordeaux command count exceeds " + MAX_COMMANDS);
            invalid = true;
            return true;
        }

        for (Element element : annotated) {
            if (element.getKind() != ElementKind.METHOD) {
                error(element, "@BordeauxCommand may only annotate methods");
                invalid = true;
                continue;
            }
            ExecutableElement method = (ExecutableElement) element;
            CommandMethod command = inspect(method);
            if (command == null) {
                invalid = true;
                continue;
            }
            ExecutableElement previous = collectedIds.putIfAbsent(command.id(), method);
            if (previous != null) {
                error(method, "Duplicate Bordeaux command ID '" + command.id() + "'");
                error(previous, "Duplicate Bordeaux command ID '" + command.id() + "'");
                invalid = true;
                continue;
            }
            collectedMethods.add(command);
        }
        return true;
    }

    private CommandMethod inspect(ExecutableElement method) {
        Elements elements = processingEnv.getElementUtils();
        Types types = processingEnv.getTypeUtils();
        TypeElement owner = (TypeElement) method.getEnclosingElement();
        BordeauxCommand annotation = method.getAnnotation(BordeauxCommand.class);
        boolean valid = true;
        if (!method.getModifiers().contains(Modifier.PUBLIC)) {
            error(method, "Bordeaux command factory methods must be public");
            valid = false;
        }
        if (!owner.getModifiers().contains(Modifier.PUBLIC)) {
            error(owner, "Bordeaux command provider types must be public");
            valid = false;
        }
        if (!owner.getTypeParameters().isEmpty() || !method.getTypeParameters().isEmpty()) {
            error(method, "Generic Bordeaux command providers and factory methods are not supported");
            valid = false;
        }
        for (TypeMirror thrown : method.getThrownTypes()) {
            error(method, "Bordeaux command factory methods must not declare checked exceptions");
            valid = false;
            break;
        }
        TypeElement commandElement = elements.getTypeElement(COMMAND_TYPE);
        if (commandElement == null) {
            error(method, "WPILib Command API was not found on the annotation processor classpath");
            return null;
        }
        if (!types.isAssignable(types.erasure(method.getReturnType()), types.erasure(commandElement.asType()))) {
            error(method, "@BordeauxCommand method must return " + COMMAND_TYPE + " or a subtype");
            valid = false;
        }
        if (!method.getModifiers().contains(Modifier.STATIC)
                && owner.getNestingKind().isNested()
                && !owner.getModifiers().contains(Modifier.STATIC)) {
            error(owner, "Nested Bordeaux command providers must be static");
            valid = false;
        }

        String ownerName = owner.getQualifiedName().toString();
        String id = annotation.id().isBlank() ? ownerName + "#" + method.getSimpleName() : annotation.id().trim();
        if (id.length() > 256 || !id.matches("[A-Za-z0-9_.:#()$,-]+")) {
            error(method, "Bordeaux command ID must be 1-256 stable identifier characters");
            valid = false;
        }
        List<Parameter> parameters = new ArrayList<>();
        if (method.getParameters().size() > MAX_PARAMETERS) {
            error(method, "Bordeaux command methods cannot exceed " + MAX_PARAMETERS + " parameters");
            return null;
        }
        for (VariableElement parameter : method.getParameters()) {
            Parameter inspected = inspectParameter(parameter);
            if (inspected == null) valid = false;
            else parameters.add(inspected);
        }
        if (!valid) return null;
        String label = annotation.label().isBlank() ? humanize(method.getSimpleName().toString()) : annotation.label();
        if (label.length() > 256 || annotation.description().length() > 2_048) {
            error(method, "Bordeaux command labels and descriptions exceed catalog limits");
            return null;
        }
        List<String> aliases = boundedTerms(method, annotation.aliases(), "aliases", false);
        List<String> semanticTags = boundedTerms(method, annotation.semanticTags(), "semantic tags", true);
        if (aliases == null || semanticTags == null) return null;
        return new CommandMethod(id, label, annotation.description(), aliases, semanticTags, ownerName,
                method.getSimpleName().toString(), method.getModifiers().contains(Modifier.STATIC), parameters);
    }

    private List<String> boundedTerms(Element element, String[] values, String label, boolean kebabCase) {
        if (values.length > 16) {
            error(element, "Bordeaux command " + label + " cannot exceed 16 entries");
            return null;
        }
        List<String> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String raw : values) {
            String value = raw.trim();
            if (value.isEmpty() || value.length() > 64 || (kebabCase && !value.matches("[a-z0-9]+(?:-[a-z0-9]+)*"))) {
                error(element, "Bordeaux command " + label + " must contain bounded" + (kebabCase ? " lowercase kebab-case" : " nonblank") + " values");
                return null;
            }
            String key = value.toLowerCase(Locale.ROOT);
            if (!seen.add(key)) {
                error(element, "Bordeaux command " + label + " cannot contain duplicates");
                return null;
            }
            result.add(value);
        }
        return result;
    }

    private Parameter inspectParameter(VariableElement parameter) {
        String unsupported = unsupportedReason(parameter.asType(), new HashSet<>(), 0);
        if (unsupported != null) {
            error(parameter, "Unsupported authored parameter type '" + parameter.asType() + "': " + unsupported);
            return null;
        }
        String parameterSchema = schema(parameter.asType(), new HashSet<>(), 0);
        BordeauxParam metadata = parameter.getAnnotation(BordeauxParam.class);
        if (metadata != null && (metadata.label().length() > 256 || metadata.description().length() > 2_048
                || metadata.unit().length() > 64 || metadata.defaultValue().length() > 262_144
                || metadata.min().length() > 128 || metadata.max().length() > 128)) {
            error(parameter, "@BordeauxParam metadata exceeds catalog limits");
            return null;
        }
        String defaultValue = metadata == null ? "" : metadata.defaultValue().trim();
        if (!defaultValue.isEmpty()) {
            try {
                defaultValue = CanonicalJson.canonicalize(defaultValue);
            } catch (IllegalArgumentException exception) {
                error(parameter, "@BordeauxParam defaultValue must be valid JSON: " + exception.getMessage());
                return null;
            }
            if (isExactIntegerType(parameter.asType().toString())
                    && (!defaultValue.matches("\"[+-]?\\d+\"") || defaultValue.length() - 2 > 1_024)) {
                error(parameter, "@BordeauxParam defaultValue for long and BigInteger must be a signed digit JSON string");
                return null;
            }
            if (isExactDecimalType(parameter.asType().toString())) {
                if (!defaultValue.matches("\"[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?\"")
                        || defaultValue.length() - 2 > 1_024) {
                    error(parameter, "@BordeauxParam defaultValue for BigDecimal must be a decimal JSON string");
                    return null;
                }
                if (!decimalExponentWithinLimit(defaultValue.substring(1, defaultValue.length() - 1))) {
                    error(parameter, "@BordeauxParam defaultValue decimal exponent cannot exceed 10000");
                    return null;
                }
            }
            String defaultError = defaultValueError(parameter.asType(), defaultValue, 0);
            if (defaultError != null) {
                error(parameter, "@BordeauxParam defaultValue " + defaultError);
                return null;
            }
        }
        if (metadata != null) {
            try {
                if ((!metadata.min().isBlank() || !metadata.max().isBlank()) && !isNumericType(parameter.asType().toString())) {
                    error(parameter, "@BordeauxParam min and max may only constrain scalar numeric parameters");
                    return null;
                }
                boolean exactInteger = isExactIntegerType(parameter.asType().toString());
                if (exactInteger && (!validSignedIntegerBound(metadata.min()) || !validSignedIntegerBound(metadata.max()))) {
                    error(parameter, "@BordeauxParam bounds for long and BigInteger must be signed digit strings without fractions or exponents");
                    return null;
                }
                if (isExactDecimalType(parameter.asType().toString())
                        && (!decimalExponentWithinLimit(metadata.min()) || !decimalExponentWithinLimit(metadata.max()))) {
                    error(parameter, "@BordeauxParam BigDecimal bound exponent cannot exceed 10000");
                    return null;
                }
                BigDecimal min = metadata.min().isBlank() ? null : new BigDecimal(metadata.min());
                BigDecimal max = metadata.max().isBlank() ? null : new BigDecimal(metadata.max());
                if (min != null && max != null && min.compareTo(max) > 0) {
                    error(parameter, "@BordeauxParam min must not exceed max");
                    return null;
                }
                if (!defaultValue.isEmpty() && isNumericType(parameter.asType().toString())) {
                    BigDecimal value = numericDefault(parameter.asType(), defaultValue);
                    if (min != null && value.compareTo(min) < 0) {
                        error(parameter, "@BordeauxParam defaultValue must be at least min");
                        return null;
                    }
                    if (max != null && value.compareTo(max) > 0) {
                        error(parameter, "@BordeauxParam defaultValue must be at most max");
                        return null;
                    }
                }
            } catch (NumberFormatException exception) {
                error(parameter, "@BordeauxParam min and max must be exact decimal strings");
                return null;
            }
        }
        return new Parameter(parameter.getSimpleName().toString(), parameter.asType(), metadata, defaultValue, parameterSchema);
    }

    private String defaultValueError(TypeMirror type, String json, int depth) {
        if (depth > MAX_SCHEMA_DEPTH) return "exceeds the nesting limit of " + MAX_SCHEMA_DEPTH;
        String javaType = type.toString();
        if (json.equals("null")) {
            return javaType.startsWith("java.util.Optional<") ? null : "must not be null";
        }
        try {
            if (isExactIntegerType(javaType)) {
                String value = CanonicalJson.stringValue(json);
                java.math.BigInteger integer = new java.math.BigInteger(value);
                if ((javaType.equals("long") || javaType.equals("java.lang.Long"))
                        && (integer.compareTo(java.math.BigInteger.valueOf(Long.MIN_VALUE)) < 0
                        || integer.compareTo(java.math.BigInteger.valueOf(Long.MAX_VALUE)) > 0)) {
                    return "is outside the signed 64-bit range";
                }
                return null;
            }
            if (isExactDecimalType(javaType)) {
                String value = CanonicalJson.stringValue(json);
                new BigDecimal(value);
                return decimalExponentWithinLimit(value) ? null : "decimal exponent cannot exceed 10000";
            }
            if (type.getKind() == TypeKind.BOOLEAN || javaType.equals("java.lang.Boolean")) {
                return json.equals("true") || json.equals("false") ? null : "must be a JSON boolean";
            }
            if (type.getKind() == TypeKind.BYTE || type.getKind() == TypeKind.SHORT || type.getKind() == TypeKind.INT
                    || javaType.equals("java.lang.Byte") || javaType.equals("java.lang.Short")
                    || javaType.equals("java.lang.Integer")) {
                if (!json.matches("-?(?:0|[1-9]\\d*)")) return "must be an integer JSON number";
                java.math.BigInteger value = new java.math.BigInteger(json);
                long minimum = type.getKind() == TypeKind.BYTE || javaType.equals("java.lang.Byte") ? Byte.MIN_VALUE
                        : type.getKind() == TypeKind.SHORT || javaType.equals("java.lang.Short") ? Short.MIN_VALUE
                        : Integer.MIN_VALUE;
                long maximum = type.getKind() == TypeKind.BYTE || javaType.equals("java.lang.Byte") ? Byte.MAX_VALUE
                        : type.getKind() == TypeKind.SHORT || javaType.equals("java.lang.Short") ? Short.MAX_VALUE
                        : Integer.MAX_VALUE;
                return value.compareTo(java.math.BigInteger.valueOf(minimum)) < 0
                        || value.compareTo(java.math.BigInteger.valueOf(maximum)) > 0
                        ? "is outside the Java integer range" : null;
            }
            if (type.getKind() == TypeKind.FLOAT || type.getKind() == TypeKind.DOUBLE
                    || javaType.equals("java.lang.Float") || javaType.equals("java.lang.Double")) {
                double value = Double.parseDouble(json);
                return Double.isFinite(value) ? null : "must be a finite JSON number";
            }
            if (javaType.equals("java.lang.String")) {
                CanonicalJson.stringValue(json);
                return null;
            }
            if (type.getKind() == TypeKind.ARRAY) {
                List<String> values = CanonicalJson.arrayValues(json);
                if (values.size() > 1_024) return "exceeds the array limit of 1024";
                for (String value : values) {
                    String error = defaultValueError(((ArrayType) type).getComponentType(), value, depth + 1);
                    if (error != null) return "array element " + error;
                }
                return null;
            }
            if (type.getKind() != TypeKind.DECLARED) return "has an unsupported Java type";
            DeclaredType declared = (DeclaredType) type;
            TypeElement element = (TypeElement) declared.asElement();
            if (element.getKind() == ElementKind.ENUM) {
                String value = CanonicalJson.stringValue(json);
                boolean known = element.getEnclosedElements().stream()
                        .anyMatch(candidate -> candidate.getKind() == ElementKind.ENUM_CONSTANT
                                && candidate.getSimpleName().contentEquals(value));
                return known ? null : "is not a declared enum value";
            }
            String raw = element.getQualifiedName().toString();
            if (raw.equals("java.util.Optional")) {
                return defaultValueError(declared.getTypeArguments().get(0), json, depth + 1);
            }
            if (isAssignableErasure(type, "java.util.Map")) {
                Map<String, String> values = CanonicalJson.objectValues(json);
                if (values.size() > MAX_OBJECT_FIELDS) return "exceeds the object-field limit of " + MAX_OBJECT_FIELDS;
                for (Map.Entry<String, String> entry : values.entrySet()) {
                    String error = defaultValueError(declared.getTypeArguments().get(1), entry.getValue(), depth + 1);
                    if (error != null) return "map value '" + entry.getKey() + "' " + error;
                }
                return null;
            }
            if (isAssignableErasure(type, "java.util.Collection")) {
                List<String> values = CanonicalJson.arrayValues(json);
                if (values.size() > 1_024) return "exceeds the array limit of 1024";
                for (String value : values) {
                    String error = defaultValueError(declared.getTypeArguments().get(0), value, depth + 1);
                    if (error != null) return "array element " + error;
                }
                return null;
            }
            Map<String, String> values = CanonicalJson.objectValues(json);
            List<SchemaField> fields = objectShape(element);
            Set<String> expected = fields.stream().map(SchemaField::name).collect(java.util.stream.Collectors.toSet());
            if (!values.keySet().equals(expected)) return "must contain exactly the declared object fields";
            for (SchemaField field : fields) {
                String error = defaultValueError(field.type(), values.get(field.name()), depth + 1);
                if (error != null) return "field '" + field.name() + "' " + error;
            }
            return null;
        } catch (IllegalArgumentException exception) {
            return "does not match " + javaType + ": " + exception.getMessage();
        }
    }

    private static BigDecimal numericDefault(TypeMirror type, String json) {
        String javaType = type.toString();
        return isExactIntegerType(javaType) || isExactDecimalType(javaType)
                ? new BigDecimal(CanonicalJson.stringValue(json)) : new BigDecimal(json);
    }

    private static boolean validSignedIntegerBound(String value) {
        return value.isBlank() || value.matches("[+-]?\\d+");
    }

    private static boolean decimalExponentWithinLimit(String value) {
        if (value.isBlank()) return true;
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("[eE]([+-]?\\d+)$").matcher(value);
        return !matcher.find() || new java.math.BigInteger(matcher.group(1)).abs()
                .compareTo(java.math.BigInteger.valueOf(10_000)) <= 0;
    }

    private static boolean isExactIntegerType(String type) {
        return type.equals("long") || type.equals("java.lang.Long") || type.equals("java.math.BigInteger");
    }

    private static boolean isExactDecimalType(String type) {
        return type.equals("java.math.BigDecimal");
    }

    private static boolean isNumericType(String type) {
        return switch (type) {
            case "byte", "short", "int", "long", "float", "double",
                    "java.lang.Byte", "java.lang.Short", "java.lang.Integer", "java.lang.Long",
                    "java.lang.Float", "java.lang.Double", "java.math.BigInteger", "java.math.BigDecimal" -> true;
            default -> false;
        };
    }

    private String unsupportedReason(TypeMirror type, Set<String> visiting, int depth) {
        if (depth > MAX_SCHEMA_DEPTH) return "type nesting exceeds " + MAX_SCHEMA_DEPTH;
        if (type.getKind() == TypeKind.CHAR) return "char values are ambiguous in JSON; use String or an enum";
        if (type.getKind().isPrimitive()) return null;
        if (type.getKind() == TypeKind.ARRAY) {
            return unsupportedReason(((ArrayType) type).getComponentType(), visiting, depth + 1);
        }
        if (type.getKind() != TypeKind.DECLARED) return "type variables, wildcards, and intersection types are not supported";
        DeclaredType declared = (DeclaredType) type;
        TypeElement element = (TypeElement) declared.asElement();
        String raw = element.getQualifiedName().toString();
        if (raw.equals("java.lang.Character")) return "Character values are ambiguous in JSON; use String or an enum";
        if (scalarKind(raw) != null) return null;
        if (element.getKind() == ElementKind.ENUM) {
            long constants = element.getEnclosedElements().stream()
                    .filter(value -> value.getKind() == ElementKind.ENUM_CONSTANT).count();
            return constants > MAX_ENUM_VALUES ? "enums cannot exceed " + MAX_ENUM_VALUES + " values" : null;
        }
        if (raw.equals("java.util.Optional")) {
            if (depth > 0) return "Optional is supported only as a top-level command parameter";
            return declared.getTypeArguments().size() == 1
                    ? unsupportedReason(declared.getTypeArguments().get(0), visiting, depth + 1)
                    : "Optional must declare one value type";
        }
        if (isAssignableErasure(type, "java.util.Map")) {
            if (declared.getTypeArguments().size() != 2) return "maps must declare String keys and a value type";
            if (!declared.getTypeArguments().get(0).toString().equals("java.lang.String")) return "map keys must be String";
            return unsupportedReason(declared.getTypeArguments().get(1), visiting, depth + 1);
        }
        if (isAssignableErasure(type, "java.util.Collection")) {
            return declared.getTypeArguments().size() == 1
                    ? unsupportedReason(declared.getTypeArguments().get(0), visiting, depth + 1)
                    : "collections must declare one element type";
        }
        if (raw.startsWith("java.")) return "this JDK type has no defined JSON conversion";
        if (element.getKind().isInterface() || element.getModifiers().contains(Modifier.ABSTRACT)) {
            return "custom objects must be concrete Jackson-deserializable classes or records";
        }
        if (!element.getModifiers().contains(Modifier.PUBLIC)) return "custom objects must be public";
        if (element.getNestingKind().isNested() && !element.getModifiers().contains(Modifier.STATIC)) {
            return "nested custom objects must be static";
        }
        String key = type.toString();
        if (!visiting.add(key)) return "recursive custom object schemas are not supported";
        List<SchemaField> shape = objectShape(element);
        if (shape.isEmpty()) return "custom objects need record components or public data fields";
        if (shape.size() > MAX_OBJECT_FIELDS) return "custom objects cannot exceed " + MAX_OBJECT_FIELDS + " fields";
        if (element.getKind() != ElementKind.RECORD && !hasPublicNoArgConstructor(element)) {
            return "custom objects with public fields need a public no-argument constructor";
        }
        for (SchemaField field : shape) {
                String reason = unsupportedReason(field.type(), visiting, depth + 1);
                if (reason != null) return reason;
        }
        visiting.remove(key);
        return null;
    }

    private String schema(TypeMirror type, Set<String> visiting, int depth) {
        String javaType = type.toString();
        if (depth > MAX_SCHEMA_DEPTH) return schemaLeaf("opaque", javaType);
        if (type.getKind().isPrimitive()) {
            return schemaLeaf(primitiveKind(type.getKind()), javaType);
        }
        if (type.getKind() == TypeKind.ARRAY) {
            return "{\"element\":" + schema(((ArrayType) type).getComponentType(), visiting, depth + 1)
                    + ",\"javaType\":" + quote(javaType) + ",\"kind\":\"array\"}";
        }
        DeclaredType declared = (DeclaredType) type;
        TypeElement element = (TypeElement) declared.asElement();
        String raw = element.getQualifiedName().toString();
        String scalar = scalarKind(raw);
        if (scalar != null) return schemaLeaf(scalar, javaType);
        if (element.getKind() == ElementKind.ENUM) {
            List<String> constants = element.getEnclosedElements().stream()
                    .filter(value -> value.getKind() == ElementKind.ENUM_CONSTANT)
                    .map(value -> quote(value.getSimpleName().toString())).toList();
            if (constants.size() > MAX_ENUM_VALUES) return schemaLeaf("opaque", javaType);
            return "{\"enumValues\":[" + String.join(",", constants) + "],\"javaType\":" + quote(javaType)
                    + ",\"kind\":\"enum\"}";
        }
        if (raw.equals("java.util.Optional")) {
            return "{\"element\":" + schema(declared.getTypeArguments().get(0), visiting, depth + 1)
                    + ",\"javaType\":" + quote(javaType) + ",\"kind\":\"optional\"}";
        }
        if (isAssignableErasure(type, "java.util.Map")) {
            return "{\"javaType\":" + quote(javaType) + ",\"kind\":\"map\",\"value\":"
                    + schema(declared.getTypeArguments().get(1), visiting, depth + 1) + "}";
        }
        if (isAssignableErasure(type, "java.util.Collection")) {
            return "{\"element\":" + schema(declared.getTypeArguments().get(0), visiting, depth + 1)
                    + ",\"javaType\":" + quote(javaType) + ",\"kind\":\"array\"}";
        }
        if (visiting.add(javaType)) {
            List<String> fields = new ArrayList<>();
            for (SchemaField field : objectShape(element)) {
                fields.add("{\"name\":" + quote(field.name()) + ",\"schema\":"
                        + schema(field.type(), visiting, depth + 1) + "}");
            }
            visiting.remove(javaType);
            return "{\"fields\":[" + String.join(",", fields) + "],\"javaType\":" + quote(javaType)
                    + ",\"kind\":\"object\"}";
        }
        return schemaLeaf("opaque", javaType);
    }

    private static List<SchemaField> objectShape(TypeElement element) {
        if (element.getKind() == ElementKind.RECORD) {
            return element.getRecordComponents().stream()
                    .map(component -> new SchemaField(component.getSimpleName().toString(), component.asType()))
                    .toList();
        }
        List<SchemaField> publicFields = element.getEnclosedElements().stream()
                .filter(value -> value.getKind() == ElementKind.FIELD)
                .filter(value -> value.getModifiers().contains(Modifier.PUBLIC))
                .filter(value -> !value.getModifiers().contains(Modifier.STATIC))
                .filter(value -> !value.getModifiers().contains(Modifier.FINAL))
                .map(value -> new SchemaField(value.getSimpleName().toString(), value.asType()))
                .toList();
        if (!publicFields.isEmpty()) return publicFields;
        return List.of();
    }

    private static boolean hasPublicNoArgConstructor(TypeElement element) {
        List<ExecutableElement> constructors = element.getEnclosedElements().stream()
                .filter(value -> value.getKind() == ElementKind.CONSTRUCTOR)
                .map(value -> (ExecutableElement) value)
                .toList();
        return constructors.isEmpty() || constructors.stream().anyMatch(value ->
                value.getModifiers().contains(Modifier.PUBLIC) && value.getParameters().isEmpty());
    }

    private String catalogId(List<CommandMethod> methods) {
        String value = processingEnv.getOptions().get("bordeaux.catalogId");
        if (value == null || value.isBlank()) value = methods.get(0).owner();
        value = value.trim();
        if (value.length() > 256) {
            processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                    "Bordeaux catalog ID must not exceed 256 characters");
            return null;
        }
        return value;
    }

    private void writeCatalog(String commandsJson, String catalogId, String catalogHash) throws IOException {
        Filer filer = processingEnv.getFiler();
        try (Writer writer = filer.createResource(StandardLocation.CLASS_OUTPUT, "", "META-INF/bordeaux/commands.json").openWriter()) {
            writer.write("{\n  \"schemaVersion\": \"1.0\",\n  \"catalogId\": " + quote(catalogId)
                    + ",\n  \"supportVersion\": \"0.1.0\",\n  \"catalogHash\": " + quote(catalogHash)
                    + ",\n  \"commands\": " + commandsJson + "\n}\n");
        }
    }

    private void writeBindings(List<CommandMethod> methods, String catalogId, String catalogHash) throws IOException {
        Map<String, String> providers = new LinkedHashMap<>();
        for (CommandMethod method : methods) {
            if (!method.isStatic()) providers.computeIfAbsent(method.owner(), ignored -> "provider" + providers.size());
        }
        JavaFileObject source = processingEnv.getFiler().createSourceFile(GENERATED_PACKAGE + "." + GENERATED_CLASS);
        try (Writer writer = source.openWriter()) {
            writer.write("package " + GENERATED_PACKAGE + ";\n\n");
            writer.write("@javax.annotation.processing.Generated(\"" + BordeauxProcessor.class.getName() + "\")\n");
            writer.write("public final class " + GENERATED_CLASS + " {\n");
            writer.write("  public static final String CATALOG_ID = " + quoteJava(catalogId) + ";\n");
            writer.write("  public static final String CATALOG_HASH = " + quoteJava(catalogHash) + ";\n");
            for (Map.Entry<String, String> provider : providers.entrySet()) {
                writer.write("  private final " + provider.getKey() + " " + provider.getValue() + ";\n");
            }
            writer.write("\n  public " + GENERATED_CLASS + "(");
            writer.write(providers.entrySet().stream().map(value -> value.getKey() + " " + value.getValue()).reduce((a, b) -> a + ", " + b).orElse(""));
            writer.write(") {\n");
            for (Map.Entry<String, String> provider : providers.entrySet()) {
                writer.write("    this." + provider.getValue() + " = java.util.Objects.requireNonNull(" + provider.getValue() + ", \"" + provider.getValue() + "\");\n");
            }
            writer.write("  }\n\n  public dev.bordeaux.runtime.BordeauxCommandRegistry registry() {\n");
            writer.write("    var builder = dev.bordeaux.runtime.BordeauxCommandRegistry.builder()"
                    + ".catalogId(CATALOG_ID).catalogHash(CATALOG_HASH);\n");
            for (CommandMethod method : methods) {
                String names = method.parameters().stream().map(parameter -> quoteJava(parameter.name())).reduce((a, b) -> a + ", " + b).orElse("");
                writer.write("    builder.register(" + quoteJava(method.id()) + ", java.util.Set.of(" + names + "), args -> ");
                writer.write(method.isStatic() ? method.owner() : providers.get(method.owner()));
                writer.write("." + method.member() + "(");
                writer.write(method.parameters().stream().map(this::argumentExpression).reduce((a, b) -> a + ", " + b).orElse(""));
                writer.write("));\n");
            }
            writer.write("    return builder.build();\n  }\n}\n");
        }
    }

    private String commandsJson(List<CommandMethod> methods) {
