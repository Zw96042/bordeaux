package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
    void gatesPositionEventsAndCatchesUpBoundedRepetitions() {
        ObjectNode arguments = MAPPER.createObjectNode();
        BordeauxEvent event = new BordeauxEvent(
                "collect", "Collect", 0.2, 0.5, "collect", arguments, false,
                BordeauxEvent.Trigger.POSITION, 0.2, 1.0, "has-note");
        BordeauxPathEvents path = new BordeauxPathEvents(
                "auto", "Auto", 1.2, CATALOG_ID, HASH, List.of(event));
        boolean[] hasNote = {false};
        BordeauxConditionRegistry conditions = BordeauxConditionRegistry.builder()
                .register("has-note", () -> hasNote[0]).build();
        List<String> created = new ArrayList<>();
        BordeauxEventRunner runner = new BordeauxEventRunner(
                path, registry(created, "collect"), conditions, new RecordingScheduler());

        runner.periodic(0.1, 0.4);
        runner.periodic(0.2, 0.5);
        assertTrue(created.isEmpty());
        hasNote[0] = true;
        runner.periodic(0.65, 0.3);
        assertEquals(List.of("collect", "collect"), created);
        runner.periodic(1.1, 0.5);
        assertEquals(4, runner.firedCount());
        assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxConditionRegistry.empty().evaluate("missing"));
    }

    @Test
    void readsMixedFollowSectionsAndTrajectorySamples() {
        BordeauxPathEvents path = read("""
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":2,
                 "samples":[
                   {"i":0,"t":0,"s":0,"f":0,"x":1,"y":2,"headingRad":0,"velocityMps":0},
                   {"i":1,"t":1,"s":1,"f":0.5,"x":2,"y":2,"headingRad":0,"velocityMps":1},
                   {"i":2,"t":2,"s":2,"f":1,"x":3,"y":2,"headingRad":0,"velocityMps":0}],
                 "followSections":[
                   {"segmentIndex":0,"mode":"time","startSample":0,"endSample":1},
                   {"segmentIndex":1,"mode":"position","startSample":1,"endSample":2}],
                 "events":[]}]}
                """);

        assertEquals(3, path.samples().size());
        assertEquals(2, path.followSections().size());
        assertEquals(BordeauxFollowSection.Mode.POSITION, path.followSections().get(1).mode());
        assertEquals(3, path.samples().get(2).xM());
    }

    @Test
    void readsStrictBetweenPathRoutineTree() {
        BordeauxPathEvents path = read("""
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "routine":{"name":"Choose note","nodes":[
                   {"id":"choose","type":"decision","cond":"has-note","thenLabel":"yes","elseLabel":"no",
                    "then":[{"id":"collect","type":"function","cat":"command","invocation":{"commandId":"collect","arguments":{}}},
                            {"id":"run","type":"path","ref":"auto"}],"else":[]}]},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[],"events":[]}]}
                """);

        BordeauxRoutineNode.Decision decision = (BordeauxRoutineNode.Decision) path.routine().nodes().get(0);

        assertEquals("has-note", decision.conditionId());
        assertTrue(decision.whenTrue().get(0) instanceof BordeauxRoutineNode.Command);
        assertTrue(decision.whenTrue().get(1) instanceof BordeauxRoutineNode.Path);
    }

    @Test
    void choosesNextPathAndSchedulesCommandsBetweenPaths() throws Exception {
        ObjectNode arguments = (ObjectNode) MAPPER.readTree("{}");
        BordeauxRoutine routine = new BordeauxRoutine("Choose note", List.of(
                new BordeauxRoutineNode.Path("first", "path-a"),
                new BordeauxRoutineNode.Decision("choose", "has-note",
                        List.of(new BordeauxRoutineNode.Command("collect", "collect", arguments),
                                new BordeauxRoutineNode.Path("a-next", "path-b")),
                        List.of(new BordeauxRoutineNode.Path("b-next", "path-c")))));
        BordeauxPathEvents document = new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), routine);
        boolean[] hasNote = {true};
        List<String> created = new ArrayList<>();
        RecordingScheduler scheduler = new RecordingScheduler();
        BordeauxRoutineRunner runner = new BordeauxRoutineRunner(document, registry(created, "collect"),
                BordeauxConditionRegistry.builder().register("has-note", () -> hasNote[0]).build(), scheduler);

        assertEquals("path-a", runner.start().orElseThrow());
        assertEquals("path-b", runner.completePath("path-a").orElseThrow());
        assertEquals(List.of("collect"), created);
        assertEquals(1, runner.commandCount());
        assertTrue(runner.completePath("path-b").isEmpty());

        hasNote[0] = false;
        runner.reset();
        runner.start();
        assertEquals("path-c", runner.completePath("path-a").orElseThrow());
        assertThrows(BordeauxRuntimeException.class, () -> runner.completePath("wrong"));
    }

    @Test
    void followsTimeThenMeasuredPositionWithoutRegressing() {
        List<BordeauxSample> samples = List.of(
                sample(0, 0, 0), sample(1, 0.5, 1), sample(2, 1, 2),
                sample(3, 1.5, 3), sample(4, 2, 4));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "mixed", "Mixed", 2, CATALOG_ID, HASH, List.of(), samples, List.of(
                        new BordeauxFollowSection(0, BordeauxFollowSection.Mode.TIME, 0, 2),
                        new BordeauxFollowSection(1, BordeauxFollowSection.Mode.POSITION, 2, 4)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(1, follower.update(0.5, 0, 0).index());
        assertEquals(2, follower.update(0.5, 0, 0).index());
        assertEquals(1, follower.sectionIndex());
        assertEquals(4, follower.update(10, 2, 0).index());
        assertFalse(follower.isFinished());
        assertEquals(4, follower.update(0.02, 3, 0).index());
        assertFalse(follower.isFinished());
        follower.update(0.02, 4, 0);
        assertTrue(follower.isFinished());

        follower.reset();
        assertEquals(0, follower.update(0, 0, 0).index());
        assertThrows(BordeauxRuntimeException.class, () -> follower.update(-1, 0, 0));
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

        assertThrows(BordeauxRuntimeException.class, () -> registry.create("strict",
                (ObjectNode) MAPPER.readTree("{\"count\":1.9,\"enabled\":true,\"target\":{\"level\":\"L4\",\"slots\":[1]}}")));
        assertThrows(BordeauxRuntimeException.class, () -> registry.create("strict",
                (ObjectNode) MAPPER.readTree("{\"count\":1,\"enabled\":\"true\",\"target\":{\"level\":\"L4\",\"slots\":[1]}}")));
        assertThrows(BordeauxRuntimeException.class, () -> registry.create("strict",
                (ObjectNode) MAPPER.readTree("{\"count\":1,\"enabled\":true,\"target\":{\"level\":\"L4\",\"slots\":[1.5]}}")));
        assertThrows(BordeauxRuntimeException.class, () -> registry.create("exact",
                (ObjectNode) MAPPER.readTree("{\"sequence\":42}")));
    }

    @Test
    void rejectsBackwardsOrInvalidElapsedTime() {
        BordeauxEventRunner runner = new BordeauxEventRunner(
                new BordeauxPathEvents("p", "P", 1, CATALOG_ID, HASH, List.of()),
                BordeauxCommandRegistry.builder().catalogId(CATALOG_ID).catalogHash(HASH).build(),
                new RecordingScheduler());
        runner.periodic(0.5);
        assertThrows(BordeauxRuntimeException.class, () -> runner.periodic(0.4));
        assertThrows(BordeauxRuntimeException.class, () -> runner.periodic(Double.NaN));
    }

    @Test
    void rejectsCatalogMismatchBeforeAnyEventCanSchedule() {
        String otherHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        BordeauxPathEvents path = new BordeauxPathEvents("p", "P", 1, CATALOG_ID, otherHash, List.of());
        RecordingScheduler scheduler = new RecordingScheduler();

        BordeauxRuntimeException mismatch = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxEventRunner(path,
                        BordeauxCommandRegistry.builder().catalogId(CATALOG_ID).catalogHash(HASH).build(), scheduler));

        assertTrue(mismatch.getMessage().contains("does not match robot registry"));
        assertTrue(scheduler.scheduled.isEmpty());
    }

    @Test
    void rejectsCatalogIdMismatchBeforeAnyEventCanSchedule() {
        BordeauxPathEvents path = new BordeauxPathEvents("p", "P", 1, "other-robot", HASH, List.of());
        RecordingScheduler scheduler = new RecordingScheduler();

        BordeauxRuntimeException mismatch = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxEventRunner(path,
                        BordeauxCommandRegistry.builder().catalogId(CATALOG_ID).catalogHash(HASH).build(), scheduler));

        assertTrue(mismatch.getMessage().contains("catalog ID"));
        assertTrue(scheduler.scheduled.isEmpty());
    }

    private static BordeauxPathEvents read(String json) {
        return BordeauxTrajectoryReader.read(
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)), "auto");
    }

    private static BordeauxSample sample(int index, double timeS, double xM) {
        return new BordeauxSample(index, timeS, xM, xM / 4, xM, 0, 0, index == 4 ? 0 : 1);
    }

    private static BordeauxCommandRegistry registry(List<String> created, String... ids) {
        BordeauxCommandRegistry.Builder builder = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID).catalogHash(HASH);
        for (String id : ids) {
            builder.register(id, Set.of(), args -> {
                created.add(id);
                return new TestCommand(id);
            });
        }
        return builder.build();
    }

    private static final class TestCommand extends Command {
        private TestCommand(String name) {
            setName(name);
        }
    }

    private static final class RecordingScheduler implements BordeauxEventRunner.Scheduler {
        private final List<Command> scheduled = new ArrayList<>();
        private final List<Command> cancelled = new ArrayList<>();

        @Override
        public void schedule(Command command) {
            scheduled.add(command);
        }

        @Override
        public void cancel(Command command) {
            cancelled.add(command);
        }
    }
}
