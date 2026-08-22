package dev.bordeaux.processor;

import dev.bordeaux.annotations.BordeauxCommand;
import dev.bordeaux.annotations.BordeauxCondition;
import dev.bordeaux.annotations.BordeauxParam;
import dev.bordeaux.annotations.BordeauxTrajectoryFallbackPolicy;
import dev.bordeaux.annotations.BordeauxTrajectoryGenerator;
import dev.bordeaux.annotations.BordeauxTrajectoryPreview;
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
import javax.lang.model.type.WildcardType;
import javax.lang.model.util.Elements;
import javax.lang.model.util.Types;
import javax.tools.Diagnostic;
import javax.tools.JavaFileObject;
import javax.tools.StandardLocation;

/** Aggregates Bordeaux command annotations into a data catalog and direct-call registry bindings. */
@SupportedOptions("bordeaux.catalogId")
public final class BordeauxProcessor extends AbstractProcessor {
    private static final String COMMAND_TYPE = "edu.wpi.first.wpilibj2.command.Command";
    private static final String SUPPLIER_TYPE = "java.util.function.Supplier";
    private static final String GENERATION_CONTEXT_TYPE = "dev.bordeaux.runtime.BordeauxGenerationContext";
    private static final String GENERATED_TRAJECTORY_TYPE = "dev.bordeaux.runtime.BordeauxGeneratedTrajectory";
    private static final String GENERATED_PACKAGE = "dev.bordeaux.generated";
    private static final String GENERATED_CLASS = "BordeauxGeneratedBindings";
    private static final int MAX_SCHEMA_DEPTH = 24;
    private static final int MAX_COMMANDS = 5_000;
    private static final int MAX_PARAMETERS = 256;
    private static final int MAX_OBJECT_FIELDS = 256;
    private static final int MAX_ENUM_VALUES = 1_024;
    private static final int MAX_CATALOG_BYTES = 2 * 1024 * 1024;
    private static final String BUILT_INS_JSON = "[{\"description\":\"Pause the routine before its next step.\",\"id\":\"bordeaux.wait\",\"kind\":\"wait\",\"label\":\"Wait\",\"parameters\":[{\"defaultValue\":1,\"description\":\"Time to wait before continuing the routine.\",\"javaType\":\"double\",\"label\":\"Duration\",\"max\":15,\"min\":0.02,\"name\":\"durationS\",\"role\":\"argument\",\"schema\":{\"javaType\":\"double\",\"kind\":\"number\"},\"unit\":\"s\"}]}]";
    private final List<CommandMethod> collectedMethods = new ArrayList<>();
    private final Map<String, Element> collectedIds = new HashMap<>();
    private final List<ConditionMethod> collectedConditions = new ArrayList<>();
    private final Map<String, ExecutableElement> collectedConditionIds = new HashMap<>();
    private final List<GeneratorMethod> collectedGenerators = new ArrayList<>();
    private final Map<String, ExecutableElement> collectedGeneratorIds = new HashMap<>();
    private boolean generated;
    private boolean invalid;

    @Override
    public Set<String> getSupportedAnnotationTypes() {
        // The owned built-in catalog exists even when a team declares no Bordeaux annotations.
        // Returning false from every processing round keeps unrelated annotations available to their processors.
        return Set.of("*");
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
            if (invalid) return false;
            List<CommandMethod> methods = collectedMethods.stream()
                    .sorted(Comparator.comparing(CommandMethod::id)).toList();
            List<ConditionMethod> conditions = collectedConditions.stream()
                    .sorted(Comparator.comparing(ConditionMethod::id)).toList();
            List<GeneratorMethod> generators = collectedGenerators.stream()
                    .sorted(Comparator.comparing(GeneratorMethod::id)).toList();
            try {
                String commandsJson = commandsJson(methods);
                String conditionsJson = conditionsJson(conditions);
                String generatorsJson = generatorsJson(generators);
                String semanticCatalog = "{\"builtIns\":" + BUILT_INS_JSON + ",\"commands\":" + commandsJson
                        + ",\"conditions\":" + conditionsJson + ",\"trajectoryGenerators\":" + generatorsJson + "}";
                if (semanticCatalog.getBytes(StandardCharsets.UTF_8).length > MAX_CATALOG_BYTES - 1_024) {
                    processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                            "Generated Bordeaux capability catalog exceeds " + MAX_CATALOG_BYTES + " bytes");
                    return false;
                }
                String catalogHash = semanticHash(CanonicalJson.canonicalize(semanticCatalog));
                String catalogId = catalogId(methods, conditions, generators);
                if (catalogId == null) return false;
                writeCatalog(commandsJson, conditionsJson, generatorsJson, catalogId, catalogHash);
                writeBindings(methods, conditions, generators, catalogId, catalogHash);
            } catch (IOException exception) {
                processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                        "Could not generate Bordeaux command metadata: " + exception.getMessage());
            }
            return false;
        }
        Set<? extends Element> annotated = roundEnvironment.getElementsAnnotatedWith(BordeauxCommand.class);
        Set<? extends Element> annotatedConditions = roundEnvironment.getElementsAnnotatedWith(BordeauxCondition.class);
        Set<? extends Element> annotatedGenerators = roundEnvironment.getElementsAnnotatedWith(BordeauxTrajectoryGenerator.class);
        if (annotated.isEmpty() && annotatedConditions.isEmpty() && annotatedGenerators.isEmpty()) return false;
        if (collectedMethods.size() + collectedConditions.size() + collectedGenerators.size()
                + annotated.size() + annotatedConditions.size() + annotatedGenerators.size() > MAX_COMMANDS) {
            processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                    "Bordeaux command count exceeds " + MAX_COMMANDS);
            invalid = true;
            return false;
        }

        for (Element element : annotated) {
            CommandMethod command;
            if (element.getKind() == ElementKind.METHOD) {
                command = inspect((ExecutableElement) element);
            } else if (element.getKind() == ElementKind.FIELD) {
                command = inspectCommandField((VariableElement) element);
            } else {
                error(element, "@BordeauxCommand may only annotate methods or fields");
                invalid = true;
                continue;
            }
            if (command == null) {
                invalid = true;
                continue;
            }
            Element previous = collectedIds.putIfAbsent(command.id(), element);
            if (previous != null || collectedConditionIds.containsKey(command.id()) || collectedGeneratorIds.containsKey(command.id())) {
                error(element, previous == null ? "Duplicate Bordeaux capability ID '" + command.id() + "'"
                        : "Duplicate Bordeaux command ID '" + command.id() + "'");
                if (previous != null) error(previous, "Duplicate Bordeaux command ID '" + command.id() + "'");
                invalid = true;
                continue;
            }
            collectedMethods.add(command);
        }
        for (Element element : annotatedConditions) {
            if (element.getKind() != ElementKind.METHOD) {
                error(element, "@BordeauxCondition may only annotate methods");
                invalid = true;
                continue;
            }
            ExecutableElement method = (ExecutableElement) element;
            ConditionMethod condition = inspectCondition(method);
            if (condition == null) {
                invalid = true;
                continue;
            }
            ExecutableElement previous = collectedConditionIds.putIfAbsent(condition.id(), method);
            if (previous != null || collectedIds.containsKey(condition.id()) || collectedGeneratorIds.containsKey(condition.id())) {
                error(method, "Duplicate Bordeaux capability ID '" + condition.id() + "'");
                if (previous != null) error(previous, "Duplicate Bordeaux capability ID '" + condition.id() + "'");
                invalid = true;
                continue;
            }
            collectedConditions.add(condition);
        }
        for (Element element : annotatedGenerators) {
            if (element.getKind() != ElementKind.METHOD) {
                error(element, "@BordeauxTrajectoryGenerator may only annotate methods");
                invalid = true;
                continue;
            }
            ExecutableElement method = (ExecutableElement) element;
            GeneratorMethod generator = inspectGenerator(method);
            if (generator == null) {
                invalid = true;
                continue;
            }
            ExecutableElement previous = collectedGeneratorIds.putIfAbsent(generator.id(), method);
            if (previous != null || collectedIds.containsKey(generator.id()) || collectedConditionIds.containsKey(generator.id())) {
                error(method, "Duplicate Bordeaux capability ID '" + generator.id() + "'");
                if (previous != null) error(previous, "Duplicate Bordeaux capability ID '" + generator.id() + "'");
                invalid = true;
                continue;
            }
            collectedGenerators.add(generator);
        }
        return false;
    }

    private GeneratorMethod inspectGenerator(ExecutableElement method) {
        TypeElement owner = (TypeElement) method.getEnclosingElement();
        BordeauxTrajectoryGenerator annotation = method.getAnnotation(BordeauxTrajectoryGenerator.class);
        boolean valid = true;
        if (!method.getModifiers().contains(Modifier.PUBLIC)) {
            error(method, "Bordeaux trajectory generator methods must be public"); valid = false;
        }
        if (!owner.getModifiers().contains(Modifier.PUBLIC)) {
            error(owner, "Bordeaux trajectory generator provider types must be public"); valid = false;
        }
        if (!owner.getTypeParameters().isEmpty() || !method.getTypeParameters().isEmpty()) {
            error(method, "Generic Bordeaux trajectory generator providers and methods are not supported"); valid = false;
        }
        if (!method.getThrownTypes().isEmpty()) {
            error(method, "Bordeaux trajectory generator methods must not declare checked exceptions"); valid = false;
        }
        if (!method.getReturnType().toString().equals(GENERATED_TRAJECTORY_TYPE)) {
            error(method, "@BordeauxTrajectoryGenerator method must return " + GENERATED_TRAJECTORY_TYPE); valid = false;
        }
        if (!method.getModifiers().contains(Modifier.STATIC)
                && owner.getNestingKind().isNested() && !owner.getModifiers().contains(Modifier.STATIC)) {
            error(owner, "Nested Bordeaux trajectory generator providers must be static"); valid = false;
        }
        if (method.getParameters().isEmpty()
                || !method.getParameters().get(0).asType().toString().equals(GENERATION_CONTEXT_TYPE)) {
            error(method, "Bordeaux trajectory generator methods must declare BordeauxGenerationContext as their first parameter");
            valid = false;
        }
        if (method.getParameters().size() > 17) {
            error(method, "Bordeaux trajectory generators cannot exceed 16 authored inputs"); valid = false;
        }
        List<Parameter> inputs = new ArrayList<>();
        for (int index = 1; index < method.getParameters().size(); index++) {
            VariableElement parameter = method.getParameters().get(index);
            if (!isGeneratorInputType(parameter.asType())) {
                error(parameter, "Trajectory generator inputs must be boolean, enum, or numeric scalar values");
                valid = false;
                continue;
            }
            BordeauxParam metadata = parameter.getAnnotation(BordeauxParam.class);
            if (parameter.getSimpleName().length() > 256 || parameter.asType().toString().length() > 512) {
                error(parameter, "Trajectory generator input names and Java types exceed catalog limits");
                valid = false;
                continue;
            }
            if (metadata != null && !metadata.defaultValue().isBlank()) {
                error(parameter, "Trajectory generator inputs must not declare default values");
                valid = false;
                continue;
            }
            if (isNumericType(parameter.asType().toString())
                    && (metadata == null || metadata.min().isBlank() || metadata.max().isBlank())) {
                error(parameter, "Numeric trajectory generator inputs require both @BordeauxParam min and max");
                valid = false;
                continue;
            }
            Parameter inspected = inspectParameter(parameter);
            if (inspected == null) valid = false;
            else inputs.add(inspected);
        }
        String ownerName = owner.getQualifiedName().toString();
        String id = annotation.id().isBlank() ? ownerName + "#" + method.getSimpleName() : annotation.id().trim();
        if (id.length() > 256 || !id.matches("[A-Za-z0-9_.:#()$,-]+")) {
            error(method, "Bordeaux trajectory generator ID must be 1-256 stable identifier characters"); valid = false;
        }
        if (annotation.preview() != BordeauxTrajectoryPreview.RUNTIME_DYNAMIC) {
            error(method, "Trajectory generator preview must be explicitly RUNTIME_DYNAMIC"); valid = false;
        }
        if (annotation.fallbackPolicy() == BordeauxTrajectoryFallbackPolicy.UNSPECIFIED) {
            error(method, "Trajectory generator fallbackPolicy must be explicitly declared"); valid = false;
        }
        valid &= generatorLimit(method, annotation.timeoutMs(), 1, 100, "timeoutMs");
        valid &= generatorLimit(method, annotation.maxSamples(), 2, 4096, "maxSamples");
        valid &= generatorLimit(method, annotation.maxDurationS(), 0.02, 15, "maxDurationS");
        valid &= generatorLimit(method, annotation.maxDistanceM(), 0, 54, "maxDistanceM");
        valid &= generatorLimit(method, annotation.maxVelocityMps(), 0, 10, "maxVelocityMps");
        valid &= generatorLimit(method, annotation.maxAccelerationMps2(), 0, 30, "maxAccelerationMps2");
        valid &= generatorLimit(method, annotation.maxCentripetalAccelerationMps2(), 0, 30, "maxCentripetalAccelerationMps2");
        valid &= generatorLimit(method, annotation.maxAngularVelocityRadps(), 0, 25, "maxAngularVelocityRadps");
        valid &= generatorLimit(method, annotation.maxAngularAccelerationRadps2(), 0, 100, "maxAngularAccelerationRadps2");
        valid &= generatorLimit(method, annotation.minClearanceM(), 0, 2, "minClearanceM");
        if (annotation.label().length() > 256 || annotation.description().length() > 2_048) {
            error(method, "Bordeaux trajectory generator labels and descriptions exceed catalog limits"); valid = false;
        }
        List<String> aliases = boundedTerms(method, annotation.aliases(), "trajectory generator aliases", false);
        List<String> tags = boundedTerms(method, annotation.semanticTags(), "trajectory generator semantic tags", true);
        if (aliases == null || tags == null) valid = false;
        if (!valid) return null;
        String label = annotation.label().isBlank() ? humanize(method.getSimpleName().toString()) : annotation.label();
        return new GeneratorMethod(id, label, annotation.description(), aliases.stream().sorted().toList(),
                tags.stream().sorted().toList(), ownerName,
                method.getSimpleName().toString(), method.getModifiers().contains(Modifier.STATIC), inputs,
                annotation.preview(), annotation.fallbackPolicy(), annotation.timeoutMs(), annotation.maxSamples(),
                annotation.maxDurationS(), annotation.maxDistanceM(), annotation.maxVelocityMps(),
                annotation.maxAccelerationMps2(), annotation.maxCentripetalAccelerationMps2(),
                annotation.maxAngularVelocityRadps(), annotation.maxAngularAccelerationRadps2(), annotation.minClearanceM());
    }

    private static boolean isGeneratorInputType(TypeMirror type) {
        if (type.getKind() == TypeKind.BOOLEAN || type.getKind().isPrimitive() && type.getKind() != TypeKind.CHAR) return true;
        if (type.getKind() != TypeKind.DECLARED) return false;
        TypeElement element = (TypeElement) ((DeclaredType) type).asElement();
        return element.getKind() == ElementKind.ENUM || type.toString().equals("java.lang.Boolean")
                || isNumericType(type.toString());
    }

    private boolean generatorLimit(Element method, int value, int minimum, int maximum, String name) {
        if (value < minimum || value > maximum) {
            error(method, "Trajectory generator " + name + " must be between " + minimum + " and " + maximum);
            return false;
        }
        return true;
    }

    private boolean generatorLimit(Element method, double value, double minimum, double maximum, String name) {
        if (!Double.isFinite(value) || value < minimum || value > maximum) {
            error(method, "Trajectory generator " + name + " must be finite and between " + minimum + " and " + maximum);
            return false;
        }
        return true;
    }

    private ConditionMethod inspectCondition(ExecutableElement method) {
        Elements elements = processingEnv.getElementUtils();
        Types types = processingEnv.getTypeUtils();
        TypeElement owner = (TypeElement) method.getEnclosingElement();
        BordeauxCondition annotation = method.getAnnotation(BordeauxCondition.class);
        boolean valid = true;
        if (!method.getModifiers().contains(Modifier.PUBLIC)) {
            error(method, "Bordeaux condition methods must be public"); valid = false;
        }
        if (!owner.getModifiers().contains(Modifier.PUBLIC)) {
            error(owner, "Bordeaux condition provider types must be public"); valid = false;
        }
        if (!owner.getTypeParameters().isEmpty() || !method.getTypeParameters().isEmpty()) {
            error(method, "Generic Bordeaux condition providers and methods are not supported"); valid = false;
        }
        if (!method.getParameters().isEmpty()) {
            error(method, "Bordeaux condition methods must not declare parameters"); valid = false;
        }
        if (method.getReturnType().getKind() != TypeKind.BOOLEAN) {
            error(method, "@BordeauxCondition method must return primitive boolean"); valid = false;
        }
        TypeElement runtimeException = elements.getTypeElement("java.lang.RuntimeException");
        TypeElement errorType = elements.getTypeElement("java.lang.Error");
        for (TypeMirror thrown : method.getThrownTypes()) {
            if (types.isAssignable(thrown, runtimeException.asType()) || types.isAssignable(thrown, errorType.asType())) continue;
            error(method, "Bordeaux condition methods must not declare checked exceptions"); valid = false;
            break;
        }
        if (!method.getModifiers().contains(Modifier.STATIC)
                && owner.getNestingKind().isNested() && !owner.getModifiers().contains(Modifier.STATIC)) {
            error(owner, "Nested Bordeaux condition providers must be static"); valid = false;
        }
        String ownerName = owner.getQualifiedName().toString();
        String id = annotation.id().isBlank() ? ownerName + "#" + method.getSimpleName() : annotation.id().trim();
        if (id.length() > 256 || !id.matches("[A-Za-z0-9_.:#()$,-]+")) {
            error(method, "Bordeaux condition ID must be 1-256 stable identifier characters"); valid = false;
        }
        if (annotation.label().length() > 256 || annotation.description().length() > 2_048) {
            error(method, "Bordeaux condition labels and descriptions exceed catalog limits"); valid = false;
        }
        List<String> aliases = boundedTerms(method, annotation.aliases(), "condition aliases", false);
        List<String> semanticTags = boundedTerms(method, annotation.semanticTags(), "condition semantic tags", true);
        if (aliases == null || semanticTags == null) valid = false;
        if (!valid) return null;
        String label = annotation.label().isBlank() ? humanize(method.getSimpleName().toString()) : annotation.label();
        return new ConditionMethod(id, label, annotation.description(), aliases, semanticTags, ownerName,
                method.getSimpleName().toString(), method.getModifiers().contains(Modifier.STATIC));
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
        return command(method, owner, annotation, CommandMemberKind.METHOD, parameters);
    }

    private CommandMethod inspectCommandField(VariableElement field) {
        Elements elements = processingEnv.getElementUtils();
        Types types = processingEnv.getTypeUtils();
        TypeElement owner = (TypeElement) field.getEnclosingElement();
        boolean valid = true;
        if (!field.getModifiers().contains(Modifier.PUBLIC)) {
            error(field, "Bordeaux command fields must be public");
            valid = false;
        }
        if (!field.getModifiers().contains(Modifier.FINAL)) {
            error(field, "Bordeaux command fields must be final");
            valid = false;
        }
        if (!owner.getModifiers().contains(Modifier.PUBLIC)) {
            error(owner, "Bordeaux command provider types must be public");
            valid = false;
        }
        if (!owner.getTypeParameters().isEmpty()) {
            error(field, "Generic Bordeaux command providers are not supported");
            valid = false;
        }
        if (!field.getModifiers().contains(Modifier.STATIC)
                && owner.getNestingKind().isNested()
                && !owner.getModifiers().contains(Modifier.STATIC)) {
            error(owner, "Nested Bordeaux command providers must be static");
            valid = false;
        }

        TypeElement commandElement = elements.getTypeElement(COMMAND_TYPE);
        TypeElement supplierElement = elements.getTypeElement(SUPPLIER_TYPE);
        if (commandElement == null) {
            error(field, "WPILib Command API was not found on the annotation processor classpath");
            return null;
        }
        CommandMemberKind memberKind = null;
        if (types.isAssignable(types.erasure(field.asType()), types.erasure(commandElement.asType()))) {
            memberKind = CommandMemberKind.COMMAND_FIELD;
        } else if (supplierElement != null
                && types.isAssignable(types.erasure(field.asType()), types.erasure(supplierElement.asType()))) {
            TypeMirror suppliedType = suppliedCommandType(field.asType(), supplierElement, new HashSet<>());
            if (suppliedType != null
                    && types.isAssignable(types.erasure(suppliedType), types.erasure(commandElement.asType()))) {
                memberKind = CommandMemberKind.SUPPLIER_FIELD;
            } else {
                error(field, "@BordeauxCommand suppliers must provide " + COMMAND_TYPE + " or a subtype");
                valid = false;
            }
        } else {
            error(field, "@BordeauxCommand fields must contain " + COMMAND_TYPE
                    + " or java.util.function.Supplier<? extends " + COMMAND_TYPE + ">");
            valid = false;
        }
        if (!valid) return null;
        return command(field, owner, field.getAnnotation(BordeauxCommand.class), memberKind, List.of());
    }

    private TypeMirror suppliedCommandType(TypeMirror type, TypeElement supplierElement, Set<String> visited) {
        Types types = processingEnv.getTypeUtils();
        if (!visited.add(type.toString())) return null;
        if (type instanceof DeclaredType declared
                && types.isSameType(types.erasure(type), types.erasure(supplierElement.asType()))) {
            if (declared.getTypeArguments().size() != 1) return null;
            TypeMirror supplied = declared.getTypeArguments().get(0);
            if (supplied instanceof WildcardType wildcard) return wildcard.getExtendsBound();
            return supplied;
        }
        for (TypeMirror supertype : types.directSupertypes(type)) {
            TypeMirror supplied = suppliedCommandType(supertype, supplierElement, visited);
            if (supplied != null) return supplied;
        }
        return null;
    }

    private CommandMethod command(Element element, TypeElement owner, BordeauxCommand annotation,
            CommandMemberKind memberKind, List<Parameter> parameters) {
        String ownerName = owner.getQualifiedName().toString();
        String id = annotation.id().isBlank() ? ownerName + "#" + element.getSimpleName() : annotation.id().trim();
        if (id.length() > 256 || !id.matches("[A-Za-z0-9_.:#()$,-]+")) {
            error(element, "Bordeaux command ID must be 1-256 stable identifier characters");
            return null;
        }
        String label = annotation.label().isBlank() ? humanize(element.getSimpleName().toString()) : annotation.label();
        if (label.length() > 256 || annotation.description().length() > 2_048) {
            error(element, "Bordeaux command labels and descriptions exceed catalog limits");
            return null;
        }
        List<String> aliases = boundedTerms(element, annotation.aliases(), "aliases", false);
        List<String> semanticTags = boundedTerms(element, annotation.semanticTags(), "semantic tags", true);
        if (aliases == null || semanticTags == null) return null;
        return new CommandMethod(id, label, annotation.description(), aliases, semanticTags, ownerName,
                element.getSimpleName().toString(), element.getModifiers().contains(Modifier.STATIC), memberKind, parameters);
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
                    .map(value -> value.getSimpleName().toString()).sorted().map(BordeauxProcessor::quote).toList();
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

    private String catalogId(List<CommandMethod> methods, List<ConditionMethod> conditions, List<GeneratorMethod> generators) {
        String value = processingEnv.getOptions().get("bordeaux.catalogId");
        if (value == null || value.isBlank()) {
            if (!methods.isEmpty()) value = methods.get(0).owner();
            else if (!conditions.isEmpty()) value = conditions.get(0).owner();
            else if (!generators.isEmpty()) value = generators.get(0).owner();
            else {
                processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                        "A Wait-only Bordeaux catalog requires -Abordeaux.catalogId=<stable-id>");
                return null;
            }
        }
        value = value.trim();
        if (value.length() > 256) {
            processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                    "Bordeaux catalog ID must not exceed 256 characters");
            return null;
        }
        return value;
    }

    private void writeCatalog(String commandsJson, String conditionsJson, String generatorsJson,
            String catalogId, String catalogHash) throws IOException {
        Filer filer = processingEnv.getFiler();
        try (Writer writer = filer.createResource(StandardLocation.CLASS_OUTPUT, "", "META-INF/bordeaux/commands.json").openWriter()) {
            writer.write("{\n  \"schemaVersion\": \"1.3\",\n  \"catalogId\": " + quote(catalogId)
                    + ",\n  \"supportVersion\": \"0.4.0\",\n  \"catalogHash\": " + quote(catalogHash)
                    + ",\n  \"builtIns\": " + BUILT_INS_JSON + ",\n  \"commands\": " + commandsJson
                    + ",\n  \"conditions\": " + conditionsJson + ",\n  \"trajectoryGenerators\": " + generatorsJson + "\n}\n");
        }
    }

    private void writeBindings(List<CommandMethod> methods, List<ConditionMethod> conditions,
            List<GeneratorMethod> generators, String catalogId, String catalogHash) throws IOException {
        Map<String, String> providers = new LinkedHashMap<>();
        for (CommandMethod method : methods) {
            if (!method.isStatic()) providers.computeIfAbsent(method.owner(), ignored -> "provider" + providers.size());
        }
        for (ConditionMethod condition : conditions) {
            if (!condition.isStatic()) providers.computeIfAbsent(condition.owner(), ignored -> "provider" + providers.size());
        }
        for (GeneratorMethod generator : generators) {
            if (!generator.isStatic()) providers.computeIfAbsent(generator.owner(), ignored -> "provider" + providers.size());
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
                writer.write("    builder.register(" + quoteJava(method.id()) + ", java.util.Set.of(" + names + "), args -> {\n");
                for (Parameter parameter : method.parameters()) {
                    writer.write("      " + argumentExpression(parameter) + ";\n");
                }
                writer.write("    }, args -> ");
                writer.write(method.isStatic() ? method.owner() : providers.get(method.owner()));
                writer.write("." + method.member());
                if (method.memberKind() == CommandMemberKind.METHOD) {
                    writer.write("(");
                    writer.write(method.parameters().stream().map(this::argumentExpression)
                            .reduce((a, b) -> a + ", " + b).orElse(""));
                    writer.write(")");
                } else if (method.memberKind() == CommandMemberKind.SUPPLIER_FIELD) {
                    writer.write(".get()");
                }
                writer.write(");\n");
            }
            writer.write("    return builder.build();\n  }\n\n  public dev.bordeaux.runtime.BordeauxConditionRegistry conditions() {\n");
            writer.write("    var builder = dev.bordeaux.runtime.BordeauxConditionRegistry.builder()"
                    + ".catalogId(CATALOG_ID).catalogHash(CATALOG_HASH);\n");
            for (ConditionMethod condition : conditions) {
                writer.write("    builder.register(" + quoteJava(condition.id()) + ", () -> ");
                writer.write(condition.isStatic() ? condition.owner() : providers.get(condition.owner()));
                writer.write("." + condition.member() + "());\n");
            }
            writer.write("    return builder.build();\n  }\n\n  public dev.bordeaux.runtime.BordeauxTrajectoryGeneratorRegistry trajectoryGenerators() {\n");
            writer.write("    var builder = dev.bordeaux.runtime.BordeauxTrajectoryGeneratorRegistry.builder()"
                    + ".catalogId(CATALOG_ID).catalogHash(CATALOG_HASH);\n");
            for (GeneratorMethod generator : generators) {
                String names = generator.inputs().stream().map(parameter -> quoteJava(parameter.name()))
                        .reduce((a, b) -> a + ", " + b).orElse("");
                writer.write("    builder.register(" + quoteJava(generator.id()) + ", java.util.Set.of(" + names + "), ");
                writer.write(generatorLimitsExpression(generator) + ", dev.bordeaux.runtime.BordeauxTrajectoryGeneratorRegistry.FallbackPolicy."
                        + generator.fallbackPolicy().name() + ", (context, args) -> ");
                writer.write(generator.isStatic() ? generator.owner() : providers.get(generator.owner()));
                writer.write("." + generator.member() + "(context");
                for (Parameter input : generator.inputs()) writer.write(", " + argumentExpression(input));
                writer.write("));\n");
            }
            writer.write("    return builder.build();\n  }\n\n  public dev.bordeaux.runtime.BordeauxCapabilities capabilities() {\n"
                    + "    return new dev.bordeaux.runtime.BordeauxCapabilities(registry(), conditions(), trajectoryGenerators());\n  }\n}\n");
        }
    }

    private static String generatorLimitsExpression(GeneratorMethod value) {
        return "new dev.bordeaux.runtime.BordeauxTrajectoryGeneratorLimits(" + value.timeoutMs() + ", "
                + value.maxSamples() + ", " + value.maxDurationS() + ", " + value.maxDistanceM() + ", "
                + value.maxVelocityMps() + ", " + value.maxAccelerationMps2() + ", "
                + value.maxCentripetalAccelerationMps2() + ", " + value.maxAngularVelocityRadps() + ", "
                + value.maxAngularAccelerationRadps2() + ", " + value.minClearanceM() + ")";
    }

    private String commandsJson(List<CommandMethod> methods) {
        List<String> commands = new ArrayList<>();
        for (CommandMethod method : methods) {
            List<Parameter> sortedParameters = method.parameters().stream()
                    .sorted(Comparator.comparing(Parameter::name)).toList();
            List<String> parameters = new ArrayList<>();
            for (Parameter parameter : sortedParameters) {
                BordeauxParam metadata = parameter.metadata();
                List<String> fields = new ArrayList<>();
                if (!parameter.defaultValue().isEmpty()) fields.add("\"defaultValue\":" + parameter.defaultValue());
                if (metadata != null && !metadata.description().isBlank()) fields.add("\"description\":" + quote(metadata.description()));
                fields.add("\"javaType\":" + quote(parameter.type().toString()));
                if (metadata != null && !metadata.label().isBlank()) fields.add("\"label\":" + quote(metadata.label()));
                if (metadata != null && !metadata.max().isBlank()) fields.add("\"max\":" + boundJson(parameter, metadata.max()));
                if (metadata != null && !metadata.min().isBlank()) fields.add("\"min\":" + boundJson(parameter, metadata.min()));
                fields.add("\"name\":" + quote(parameter.name()));
                fields.add("\"role\":\"argument\"");
                fields.add("\"schema\":" + parameter.schema());
                if (metadata != null && !metadata.unit().isBlank()) fields.add("\"unit\":" + quote(metadata.unit()));
                parameters.add("{" + String.join(",", fields) + "}");
            }
            List<String> fields = new ArrayList<>();
            if (!method.aliases().isEmpty()) fields.add("\"aliases\":[" + method.aliases().stream().map(BordeauxProcessor::quote).reduce((a, b) -> a + "," + b).orElse("") + "]");
            fields.add("\"confidence\":\"confirmed\"");
            if (!method.description().isBlank()) fields.add("\"description\":" + quote(method.description()));
            fields.add("\"id\":" + quote(method.id()));
            fields.add("\"kind\":\"factory\"");
            fields.add("\"label\":" + quote(method.label()));
            fields.add("\"member\":" + quote(method.member()));
            fields.add("\"ownerType\":" + quote(method.owner()));
            fields.add("\"parameters\":[" + String.join(",", parameters) + "]");
            if (!method.semanticTags().isEmpty()) fields.add("\"semanticTags\":[" + method.semanticTags().stream().map(BordeauxProcessor::quote).reduce((a, b) -> a + "," + b).orElse("") + "]");
            fields.add("\"source\":{\"file\":" + quote(method.owner().replace('.', '/') + ".java") + ",\"line\":0}");
            commands.add("{" + String.join(",", fields) + "}");
        }
        return "[" + String.join(",", commands) + "]";
    }

    private String conditionsJson(List<ConditionMethod> conditions) {
        List<String> values = new ArrayList<>();
        for (ConditionMethod condition : conditions) {
            List<String> fields = new ArrayList<>();
            if (!condition.aliases().isEmpty()) fields.add("\"aliases\":[" + condition.aliases().stream().map(BordeauxProcessor::quote).reduce((a, b) -> a + "," + b).orElse("") + "]");
            fields.add("\"confidence\":\"confirmed\"");
            if (!condition.description().isBlank()) fields.add("\"description\":" + quote(condition.description()));
            fields.add("\"id\":" + quote(condition.id()));
            fields.add("\"kind\":\"condition\"");
            fields.add("\"label\":" + quote(condition.label()));
            fields.add("\"member\":" + quote(condition.member()));
            fields.add("\"ownerType\":" + quote(condition.owner()));
            if (!condition.semanticTags().isEmpty()) fields.add("\"semanticTags\":[" + condition.semanticTags().stream().map(BordeauxProcessor::quote).reduce((a, b) -> a + "," + b).orElse("") + "]");
            fields.add("\"source\":{\"file\":" + quote(condition.owner().replace('.', '/') + ".java") + ",\"line\":0}");
            values.add("{" + String.join(",", fields) + "}");
        }
        return "[" + String.join(",", values) + "]";
    }

    private String generatorsJson(List<GeneratorMethod> generators) {
        List<String> values = new ArrayList<>();
        for (GeneratorMethod generator : generators) {
            List<String> inputs = new ArrayList<>();
            for (Parameter input : generator.inputs().stream().sorted(Comparator.comparing(Parameter::name)).toList()) {
                BordeauxParam metadata = input.metadata();
                List<String> fields = new ArrayList<>();
                if (!input.defaultValue().isEmpty()) fields.add("\"defaultValue\":" + input.defaultValue());
                if (metadata != null && !metadata.description().isBlank()) fields.add("\"description\":" + quote(metadata.description()));
                fields.add("\"javaType\":" + quote(input.type().toString()));
                if (metadata != null && !metadata.label().isBlank()) fields.add("\"label\":" + quote(metadata.label()));
                if (metadata != null && !metadata.max().isBlank()) fields.add("\"max\":" + boundJson(input, metadata.max()));
                if (metadata != null && !metadata.min().isBlank()) fields.add("\"min\":" + boundJson(input, metadata.min()));
                fields.add("\"name\":" + quote(input.name()));
                fields.add("\"role\":\"argument\"");
                fields.add("\"schema\":" + input.schema());
                if (metadata != null && !metadata.unit().isBlank()) fields.add("\"unit\":" + quote(metadata.unit()));
                inputs.add("{" + String.join(",", fields) + "}");
            }
            List<String> fields = new ArrayList<>();
            if (!generator.aliases().isEmpty()) fields.add("\"aliases\":[" + generator.aliases().stream().map(BordeauxProcessor::quote).reduce((a, b) -> a + "," + b).orElse("") + "]");
            if (!generator.description().isBlank()) fields.add("\"description\":" + quote(generator.description()));
            fields.add("\"fallbackPolicy\":" + quote(generator.fallbackPolicy() == BordeauxTrajectoryFallbackPolicy.SAFE_STOP_ONLY ? "safeStopOnly" : "validatedBranch"));
            fields.add("\"id\":" + quote(generator.id()));
            fields.add("\"inputs\":[" + String.join(",", inputs) + "]");
            fields.add("\"label\":" + quote(generator.label()));
            fields.add("\"limits\":{" + generatorLimitsJson(generator) + "}");
            fields.add("\"member\":" + quote(generator.member()));
            fields.add("\"ownerType\":" + quote(generator.owner()));
            fields.add("\"preview\":{\"kind\":\"runtimeDynamic\"}");
            if (!generator.semanticTags().isEmpty()) fields.add("\"semanticTags\":[" + generator.semanticTags().stream().map(BordeauxProcessor::quote).reduce((a, b) -> a + "," + b).orElse("") + "]");
            fields.add("\"source\":{\"file\":" + quote(generator.owner().replace('.', '/') + ".java") + ",\"line\":0}");
            values.add("{" + String.join(",", fields) + "}");
        }
        return "[" + String.join(",", values) + "]";
    }

    private static String generatorLimitsJson(GeneratorMethod value) {
        return "\"maxAccelerationMps2\":" + value.maxAccelerationMps2()
                + ",\"maxAngularAccelerationRadps2\":" + value.maxAngularAccelerationRadps2()
                + ",\"maxAngularVelocityRadps\":" + value.maxAngularVelocityRadps()
                + ",\"maxCentripetalAccelerationMps2\":" + value.maxCentripetalAccelerationMps2()
                + ",\"maxDistanceM\":" + value.maxDistanceM()
                + ",\"maxDurationS\":" + value.maxDurationS()
                + ",\"maxSamples\":" + value.maxSamples()
                + ",\"maxVelocityMps\":" + value.maxVelocityMps()
                + ",\"minClearanceM\":" + value.minClearanceM()
                + ",\"timeoutMs\":" + value.timeoutMs();
    }

    private static String boundJson(Parameter parameter, String value) {
        String type = parameter.type().toString();
        return isExactIntegerType(type) || isExactDecimalType(type)
                ? quote(value) : CanonicalJson.canonicalize(value);
    }

    private static String semanticHash(String canonicalCommandsJson) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonicalCommandsJson.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder("sha256:");
            for (byte value : digest) hex.append(String.format("%02x", value & 0xff));
            return hex.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Java runtime does not provide SHA-256", exception);
        }
    }

    private String argumentExpression(Parameter parameter) {
        String name = quoteJava(parameter.name());
        String type = parameter.type().toString();
        BordeauxParam metadata = parameter.metadata();
        String minimum = metadata == null || metadata.min().isBlank() ? "null" : quoteJava(metadata.min());
        String maximum = metadata == null || metadata.max().isBlank() ? "null" : quoteJava(metadata.max());
        boolean bounded = !minimum.equals("null") || !maximum.equals("null");
        String bounds = ", " + minimum + ", " + maximum;
        if (type.equals("long") || type.equals("java.lang.Long")) return "args.requireLong(" + name + (bounded ? bounds : "") + ")";
        if (type.equals("java.math.BigInteger")) return "args.requireBigInteger(" + name + (bounded ? bounds : "") + ")";
        if (type.equals("java.math.BigDecimal")) return "args.requireBigDecimal(" + name + (bounded ? bounds : "") + ")";
        if (type.equals("double") || type.equals("java.lang.Double")) return "args.requireDouble(" + name + (bounded ? bounds : "") + ")";
        if (type.equals("float") || type.equals("java.lang.Float")) return "args.requireFloat(" + name + (bounded ? bounds : "") + ")";
        if (type.startsWith("java.util.Optional<")) {
            String inner = type.substring("java.util.Optional<".length(), type.length() - 1);
            return "args.optional(" + name + ", new com.fasterxml.jackson.core.type.TypeReference<" + inner + ">() {})";
        }
        if (bounded && isNumericType(type)) {
            return "args.requireNumber(" + name + ", new com.fasterxml.jackson.core.type.TypeReference<" + boxed(type)
                    + ">() {}" + bounds + ")";
        }
        return "args.require(" + name + ", new com.fasterxml.jackson.core.type.TypeReference<" + boxed(type) + ">() {})";
    }

    private boolean isAssignableErasure(TypeMirror type, String targetName) {
        TypeElement target = processingEnv.getElementUtils().getTypeElement(targetName);
        return target != null && processingEnv.getTypeUtils().isAssignable(
                processingEnv.getTypeUtils().erasure(type), processingEnv.getTypeUtils().erasure(target.asType()));
    }

    private static String boxed(String type) {
        return switch (type) {
            case "boolean" -> "java.lang.Boolean";
            case "byte" -> "java.lang.Byte";
            case "short" -> "java.lang.Short";
            case "int" -> "java.lang.Integer";
            case "float" -> "java.lang.Float";
            case "double" -> "java.lang.Double";
            case "char" -> "java.lang.Character";
            default -> type;
        };
    }

    private static String primitiveKind(TypeKind kind) {
        return switch (kind) {
            case BOOLEAN -> "boolean";
            case BYTE, SHORT, INT, LONG -> kind == TypeKind.LONG ? "integerString" : "integer";
            case CHAR -> "string";
            case FLOAT, DOUBLE -> "number";
            default -> "opaque";
        };
    }

    private static String scalarKind(String raw) {
        return switch (raw) {
            case "java.lang.Boolean" -> "boolean";
            case "java.lang.Byte", "java.lang.Short", "java.lang.Integer" -> "integer";
            case "java.lang.Character" -> "string";
            case "java.lang.Long", "java.math.BigInteger" -> "integerString";
            case "java.math.BigDecimal" -> "decimalString";
            case "java.lang.Float", "java.lang.Double" -> "number";
            case "java.lang.String" -> "string";
            default -> null;
        };
    }

    private static String schemaLeaf(String kind, String javaType) {
        return "{\"javaType\":" + quote(javaType) + ",\"kind\":" + quote(kind) + "}";
    }

    private static String humanize(String value) {
        return value.replaceAll("([a-z0-9])([A-Z])", "$1 $2").replace('_', ' ')
                .replaceFirst("^.", value.substring(0, 1).toUpperCase(Locale.ROOT));
    }

    private static String quote(String value) {
        return quoteJava(value);
    }

    private static String quoteJava(String value) {
        StringBuilder result = new StringBuilder("\"");
        for (int index = 0; index < value.length(); index++) {
            char ch = value.charAt(index);
            switch (ch) {
                case '\\' -> result.append("\\\\");
                case '"' -> result.append("\\\"");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (ch < 0x20) result.append(String.format("\\u%04x", (int) ch));
                    else result.append(ch);
                }
            }
        }
        return result.append('"').toString();
    }

    private void error(Element element, String message) {
        processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR, message, element);
    }

    private record CommandMethod(
            String id, String label, String description, List<String> aliases, List<String> semanticTags, String owner, String member,
            boolean isStatic, CommandMemberKind memberKind, List<Parameter> parameters) {}

    private enum CommandMemberKind { METHOD, COMMAND_FIELD, SUPPLIER_FIELD }

    private record ConditionMethod(
            String id, String label, String description, List<String> aliases, List<String> semanticTags, String owner,
            String member, boolean isStatic) {}

    private record GeneratorMethod(
            String id, String label, String description, List<String> aliases, List<String> semanticTags,
            String owner, String member, boolean isStatic, List<Parameter> inputs,
            BordeauxTrajectoryPreview preview, BordeauxTrajectoryFallbackPolicy fallbackPolicy,
            int timeoutMs, int maxSamples, double maxDurationS, double maxDistanceM,
            double maxVelocityMps, double maxAccelerationMps2, double maxCentripetalAccelerationMps2,
            double maxAngularVelocityRadps, double maxAngularAccelerationRadps2, double minClearanceM) {}

    private record Parameter(
            String name, TypeMirror type, BordeauxParam metadata, String defaultValue, String schema) {}

    private record SchemaField(String name, TypeMirror type) {}

}
