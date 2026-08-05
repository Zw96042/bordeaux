package dev.bordeaux.processor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.StreamSupport;
import javax.annotation.processing.AbstractProcessor;
import javax.annotation.processing.Processor;
import javax.annotation.processing.RoundEnvironment;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BordeauxProcessorTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path temporaryDirectory;

    @Test
    void generatesDeterministicCatalogAndDirectProviderBindings() throws Exception {
        String source = """
                package frc.robot;
                import dev.bordeaux.annotations.*;
                import edu.wpi.first.wpilibj2.command.Command;
                import java.math.*;
                import java.util.*;
                public final class Actions {
                  public record Target(String level, List<Integer> slots) {}
                  @BordeauxCommand(id="super.score", label="Score", description="Scores a game piece", aliases={"shoot", "score"}, semanticTags={"shoot-fuel"})
                  public Command score(
                    @BordeauxParam(label="Sequence", defaultValue="\\\"9007199254740993\\\"", min="0", max="9223372036854775807") long sequence,
                    @BordeauxParam(defaultValue="{\\\"slots\\\":[1.00],\\\"level\\\":\\\"L4\\\"}") Target target,
                    Optional<String> note,
                    Map<String, BigDecimal> gains) { return null; }
                }
                """;
        Compilation result = compile("frc/robot/Actions.java", source);
        assertTrue(result.success(), result.messages());

        JsonNode catalog = MAPPER.readTree(Files.readString(
                result.classes().resolve("META-INF/bordeaux/commands.json")));
        assertEquals("1.0", catalog.path("schemaVersion").textValue());
        assertEquals("test-robot", catalog.path("catalogId").textValue());
        assertEquals("0.1.0", catalog.path("supportVersion").textValue());
        assertEquals("super.score", catalog.path("commands").get(0).path("id").textValue());
        assertEquals("shoot", catalog.path("commands").get(0).path("aliases").get(0).textValue());
        assertEquals("shoot-fuel", catalog.path("commands").get(0).path("semanticTags").get(0).textValue());
        assertEquals(List.of("gains", "note", "sequence", "target"),
                StreamSupport.stream(catalog.path("commands").get(0).path("parameters").spliterator(), false)
                        .map(value -> value.path("name").textValue()).toList());
        JsonNode sequence = StreamSupport.stream(
                        catalog.path("commands").get(0).path("parameters").spliterator(), false)
                .filter(value -> value.path("name").textValue().equals("sequence")).findFirst().orElseThrow();
        assertEquals("integerString", sequence.path("schema").path("kind").textValue());
        assertTrue(sequence.path("max").isTextual());
        assertEquals(canonicalHash(catalog.path("commands")), catalog.path("catalogHash").textValue());

        String bindings = Files.readString(result.generated().resolve(
                "dev/bordeaux/generated/BordeauxGeneratedBindings.java"));
        assertTrue(bindings.contains("private final frc.robot.Actions provider0"));
        assertTrue(bindings.contains("provider0.score("));
        assertTrue(bindings.contains("args.requireLong(\"sequence\", \"0\", \"9223372036854775807\")"));
        assertTrue(bindings.contains("CATALOG_ID = \"test-robot\""));
        assertTrue(bindings.contains(".catalogId(CATALOG_ID).catalogHash(CATALOG_HASH)"));
        assertTrue(bindings.contains(catalog.path("catalogHash").textValue()));
        assertTrue(Files.exists(result.classes().resolve("dev/bordeaux/generated/BordeauxGeneratedBindings.class")));

        Compilation second = compile("frc/robot/Actions.java", source);
        JsonNode secondCatalog = MAPPER.readTree(Files.readString(
                second.classes().resolve("META-INF/bordeaux/commands.json")));
        assertEquals(catalog.path("catalogHash"), secondCatalog.path("catalogHash"));
    }

    @Test
    void rejectsDuplicateIdsInvalidReturnTypesAndUnsupportedShapes() throws Exception {
        Compilation duplicates = compile("frc/robot/Duplicates.java", """
                package frc.robot;
                import dev.bordeaux.annotations.BordeauxCommand;
                import edu.wpi.first.wpilibj2.command.Command;
                public final class Duplicates {
                  @BordeauxCommand(id="same") public Command first() { return null; }
                  @BordeauxCommand(id="same") public Command second() { return null; }
                }
                """);
        assertFalse(duplicates.success());
        assertTrue(duplicates.messages().contains("Duplicate Bordeaux command ID 'same'"));

        Compilation invalid = compile("frc/robot/Invalid.java", """
                package frc.robot;
                import dev.bordeaux.annotations.BordeauxCommand;
                import edu.wpi.first.wpilibj2.command.Command;
                import java.util.Map;
                public final class Invalid {
                  public static final class Payload { public int value; private Payload(int value) { this.value = value; } }
                  @BordeauxCommand public String wrong(Map<Integer, String> values) { return ""; }
                  @BordeauxCommand public Command badChar(char value) { return null; }
                  @BordeauxCommand public Command badObject(Payload value) { return null; }
                }
                """);
        assertFalse(invalid.success());
        assertTrue(invalid.messages().contains("must return edu.wpi.first.wpilibj2.command.Command"));
        assertTrue(invalid.messages().contains("map keys must be String"));
        assertTrue(invalid.messages().contains("char values are ambiguous"));
        assertTrue(invalid.messages().contains("public no-argument constructor"));

        Compilation badBound = compile("frc/robot/BadBound.java", """
                package frc.robot;
                import dev.bordeaux.annotations.*;
                import edu.wpi.first.wpilibj2.command.Command;
                public final class BadBound {
                  @BordeauxCommand public Command action(@BordeauxParam(min="1.5") long count) { return null; }
                }
                """);
        assertFalse(badBound.success());
        assertTrue(badBound.messages().contains("signed digit strings"));
    }

    @Test
    void semanticChangesChangeTheCatalogHash() throws Exception {
        Compilation first = compile("frc/robot/HashActions.java", providerWithLabel("One"));
        String firstHash = MAPPER.readTree(Files.readString(
                first.classes().resolve("META-INF/bordeaux/commands.json"))).path("catalogHash").textValue();
        Compilation second = compile("frc/robot/HashActions.java", providerWithLabel("Two"));
        String secondHash = MAPPER.readTree(Files.readString(
                second.classes().resolve("META-INF/bordeaux/commands.json"))).path("catalogHash").textValue();
        assertNotEquals(firstHash, secondHash);
    }

    @Test
    void rejectsDefaultsThatDoNotMatchSchemaOrBoundsAndNestedOptional() throws Exception {
        Compilation result = compile("frc/robot/BadDefaults.java", """
                package frc.robot;
                import dev.bordeaux.annotations.*;
                import edu.wpi.first.wpilibj2.command.Command;
                import java.math.BigDecimal;
                import java.util.*;
                public final class BadDefaults {
                  public record Target(String level, List<Integer> slots) {}
                  @BordeauxCommand(id="fractional") public Command fractional(
                    @BordeauxParam(defaultValue="1.5") int count) { return null; }
                  @BordeauxCommand(id="coerced") public Command coerced(
                    @BordeauxParam(defaultValue="\\\"true\\\"") boolean enabled) { return null; }
                  @BordeauxCommand(id="incomplete") public Command incomplete(
                    @BordeauxParam(defaultValue="{\\\"level\\\":\\\"L4\\\"}") Target target) { return null; }
                  @BordeauxCommand(id="range") public Command range(
                    @BordeauxParam(defaultValue="0", min="1") int count) { return null; }
                  @BordeauxCommand(id="exponent") public Command exponent(
                    @BordeauxParam(defaultValue="\\\"1e10001\\\"") BigDecimal value) { return null; }
                  @BordeauxCommand(id="optional") public Command optional(
                    List<Optional<String>> values) { return null; }
                }
                """);

        assertFalse(result.success());
        assertTrue(result.messages().contains("must be an integer JSON number"), result.messages());
        assertTrue(result.messages().contains("must be a JSON boolean"), result.messages());
        assertTrue(result.messages().contains("exactly the declared object fields"), result.messages());
        assertTrue(result.messages().contains("must be at least min"), result.messages());
