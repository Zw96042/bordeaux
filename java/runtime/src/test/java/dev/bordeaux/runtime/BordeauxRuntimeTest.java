package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.bordeaux.generated.BordeauxGeneratedBindings.FirstProvider;
import dev.bordeaux.generated.BordeauxGeneratedBindings.SecondProvider;
import edu.wpi.first.wpilibj2.command.Command;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class BordeauxRuntimeTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CATALOG_ID = "test-robot";
    private static final String HASH = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    @Test
    void bootstrapsFinalRoundGeneratedBindingsByProviderType() {
        BordeauxCommandRegistry registry = BordeauxBindings.generated(new SecondProvider(), new FirstProvider());

        assertEquals("test-bindings", registry.catalogId());
        assertEquals(HASH, registry.catalogHash());
        assertThrows(BordeauxRuntimeException.class, () -> BordeauxBindings.generated(new FirstProvider()));
    }

    record Target(String level, List<Integer> slots) {}

    @Test
    void convertsExactNumbersAndCustomRecordsWithoutPrecisionLoss() throws Exception {
        List<Object> received = new ArrayList<>();
        BordeauxCommandRegistry registry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID)
                .catalogHash(HASH)
                .register("score", Set.of("sequence", "count", "ratio", "target"), args -> {
                    received.add(args.requireLong("sequence"));
                    received.add(args.requireBigInteger("count"));
                    received.add(args.requireBigDecimal("ratio"));
                    received.add(args.require("target", new TypeReference<Target>() {}));
                    return new TestCommand("score");
                })
                .build();
        ObjectNode arguments = (ObjectNode) MAPPER.readTree("""
                {"sequence":"9007199254740993","count":"123456789012345678901234567890",
                 "ratio":"0.12345678901234567890","target":{"level":"L4","slots":[1,2]}}
                """);

        registry.create("score", arguments);

        assertEquals(9_007_199_254_740_993L, received.get(0));
        assertEquals(new BigInteger("123456789012345678901234567890"), received.get(1));
        assertEquals(new BigDecimal("0.12345678901234567890"), received.get(2));
        assertEquals(new Target("L4", List.of(1, 2)), received.get(3));
    }

    @Test
    void catchesUpDueEventsInStableTimeOrderExactlyOnceAndCanReset() {
        BordeauxPathEvents path = read("""
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":2,"samples":[],
                 "events":[
                   {"eventId":"later","name":"Later","timeS":1.0,"fraction":0.5,"commandId":"later","arguments":{},"cancelOnPathEnd":false},
                   {"eventId":"first","name":"First","timeS":0.2,"fraction":0.1,"commandId":"first","arguments":{},"cancelOnPathEnd":false},
                   {"eventId":"same-time","name":"Same","timeS":1.0,"fraction":0.5,"commandId":"same","arguments":{},"cancelOnPathEnd":false}
                 ]}]}
                """);
        List<String> created = new ArrayList<>();
        BordeauxCommandRegistry registry = registry(created, "first", "later", "same");
        RecordingScheduler scheduler = new RecordingScheduler();
        BordeauxEventRunner runner = new BordeauxEventRunner(path, registry, scheduler);

        runner.periodic(0.1);
        runner.periodic(1.5);
        runner.periodic(1.8);

        assertEquals(List.of("first", "later", "same"), created);
        assertEquals(3, runner.firedCount());
        runner.reset();
        runner.periodic(2.0);
        assertEquals(List.of("first", "later", "same", "first", "later", "same"), created);
    }

    @Test
    void cancelsOnlyCommandsWhoseInvocationOptsIntoPathOwnership() {
        BordeauxPathEvents path = read("""
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":2,"samples":[],
                 "events":[
                   {"eventId":"owned","name":"Owned","timeS":0.1,"fraction":0.1,"commandId":"owned","arguments":{},"cancelOnPathEnd":true},
                   {"eventId":"ordinary","name":"Ordinary","timeS":0.2,"fraction":0.2,"commandId":"ordinary","arguments":{},"cancelOnPathEnd":false}
                 ]}]}
                """);
        RecordingScheduler scheduler = new RecordingScheduler();
        BordeauxEventRunner runner = new BordeauxEventRunner(path, registry(new ArrayList<>(), "owned", "ordinary"), scheduler);
        runner.periodic(1.0);

        runner.endPath();

        assertEquals(List.of("owned"), scheduler.cancelled.stream().map(Command::getName).toList());
        assertThrows(BordeauxRuntimeException.class, () -> runner.periodic(1.1));
        runner.reset();
        runner.periodic(1.0);
        runner.reset();
        assertEquals(List.of("owned", "owned"), scheduler.cancelled.stream().map(Command::getName).toList());
    }

    @Test
    void reportsMissingIdsBadArgumentsAndMalformedEventContracts() throws Exception {
        BordeauxCommandRegistry registry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID)
                .catalogHash(HASH)
                .register("needs-count", Set.of("count"), args -> new TestCommand("count-" + args.requireLong("count")))
                .build();
        ObjectNode empty = MAPPER.createObjectNode();
        BordeauxRuntimeException missingId = assertThrows(BordeauxRuntimeException.class,
                () -> registry.create("missing", empty));
        assertTrue(missingId.getMessage().contains("unknown Bordeaux command ID"));
        BordeauxRuntimeException missingArg = assertThrows(BordeauxRuntimeException.class,
                () -> registry.create("needs-count", empty));
        assertTrue(missingArg.getMessage().contains("'count' is required"));
        BordeauxRuntimeException badLong = assertThrows(BordeauxRuntimeException.class,
                () -> registry.create("needs-count", (ObjectNode) MAPPER.readTree("{\"count\":\"9223372036854775808\"}")));
        assertTrue(badLong.getMessage().contains("outside the Java integer range"));

        BordeauxRuntimeException duplicate = assertThrows(BordeauxRuntimeException.class, () -> read("""
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[],
                 "events":[
                  {"eventId":"event","name":"A","timeS":0.1,"fraction":0.1,"commandId":"a","arguments":{},"cancelOnPathEnd":false},
                  {"eventId":"event","name":"B","timeS":0.2,"fraction":0.2,"commandId":"b","arguments":{},"cancelOnPathEnd":false}
                 ]}]}
                """));
        assertTrue(duplicate.getMessage().contains("duplicate event ID"));
    }

    @Test
    void enforcesGeneratedNumericBoundsAtRuntime() throws Exception {
        BordeauxCommandRegistry registry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID)
                .catalogHash(HASH)
                .register("bounded", Set.of("count"), args ->
                        new TestCommand("count-" + args.requireLong("count", "1", "4")))
                .build();

        BordeauxRuntimeException below = assertThrows(BordeauxRuntimeException.class,
                () -> registry.create("bounded", (ObjectNode) MAPPER.readTree("{\"count\":\"0\"}")));
        BordeauxRuntimeException above = assertThrows(BordeauxRuntimeException.class,
                () -> registry.create("bounded", (ObjectNode) MAPPER.readTree("{\"count\":\"5\"}")));

        assertTrue(below.getMessage().contains("at least 1"));
        assertTrue(above.getMessage().contains("at most 4"));
    }

    @Test
    void rejectsJacksonScalarCoercionsRecursively() throws Exception {
        BordeauxCommandRegistry registry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID)
                .catalogHash(HASH)
                .register("strict", Set.of("count", "enabled", "target"), args -> {
                    args.require("count", new TypeReference<Integer>() {});
                    args.require("enabled", new TypeReference<Boolean>() {});
                    args.require("target", new TypeReference<Target>() {});
                    return new TestCommand("strict");
                })
                .register("exact", Set.of("sequence"), args ->
                        new TestCommand("exact-" + args.requireLong("sequence")))
                .build();

