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
