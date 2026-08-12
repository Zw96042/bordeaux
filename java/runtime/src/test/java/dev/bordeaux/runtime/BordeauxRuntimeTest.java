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
import java.util.Map;
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
    void positionEventsAdvanceOnlyFromMeasuredProgress() {
        BordeauxEvent event = new BordeauxEvent(
                "collect", "Collect", 0.2, 0.5, "collect", MAPPER.createObjectNode(), false,
                BordeauxEvent.Trigger.POSITION, null, null, null);
        BordeauxPathEvents path = new BordeauxPathEvents(
                "auto", "Auto", 1, CATALOG_ID, HASH, List.of(event));
        List<String> created = new ArrayList<>();
        BordeauxEventRunner runner = new BordeauxEventRunner(
                path, registry(created, "collect"), new RecordingScheduler());

        runner.periodic(0.9);
        assertTrue(created.isEmpty());
        runner.periodic(1.0, 0.5);
        assertEquals(List.of("collect"), created);
    }

    @Test
    void expiresConditionalOneShotEventsAtTheirEndTime() {
        ObjectNode arguments = MAPPER.createObjectNode();
        BordeauxEvent event = new BordeauxEvent(
                "collect", "Collect", 0.2, 0.2, "collect", arguments, false,
                BordeauxEvent.Trigger.TIME, null, 0.5, "has-note");
        BordeauxPathEvents path = new BordeauxPathEvents(
                "auto", "Auto", 1, CATALOG_ID, HASH, List.of(event));
        boolean[] hasNote = {false};
        List<String> created = new ArrayList<>();
        BordeauxEventRunner runner = new BordeauxEventRunner(
                path, registry(created, "collect"),
                BordeauxConditionRegistry.builder().register("has-note", () -> hasNote[0]).build(),
                new RecordingScheduler());

        runner.periodic(0.2);
        hasNote[0] = true;
        runner.periodic(0.6);

        assertTrue(created.isEmpty());
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
    void streamsPathsWhilePreservingIdPrecedenceOverAnEarlierNameMatch() {
        BordeauxPathEvents path = read("""
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "paths":[
                   {"id":"other","name":"auto","totalTimeS":1,"samples":[],"events":[]},
                   {"id":"auto","name":"Selected by ID","totalTimeS":2,"samples":[],"events":[]}]}
                """);

        assertEquals("Selected by ID", path.name());
        assertEquals(2, path.totalTimeS());
    }

    @Test
    void rejectsDocumentsAboveRobotSafeByteAndSampleCeilings() {
        String oversizedBytes = """
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux","padding":"%s",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[],"events":[]}]}
                """.formatted("x".repeat(BordeauxTrajectoryReader.MAX_BYTES));
        BordeauxRuntimeException byteLimit = assertThrows(BordeauxRuntimeException.class,
                () -> read(oversizedBytes));
        assertTrue(byteLimit.getMessage().contains("byte limit"));

        String oversizedSamples = "{},".repeat(BordeauxTrajectoryReader.MAX_SAMPLES) + "{}";
        String sampleDocument = """
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[%s],"events":[]}]}
                """.formatted(oversizedSamples);
        BordeauxRuntimeException sampleLimit = assertThrows(BordeauxRuntimeException.class,
                () -> read(sampleDocument));
        assertTrue(sampleLimit.getMessage().contains("sample limit"));
    }

    @Test
    void readsStrictBetweenPathRoutineTree() {
        BordeauxPathEvents path = readWithRoutine("""
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
    void toleratesLegacyRoutineNodesUnlessRoutineReadingIsRequested() {
        String json = """
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "routine":{"name":"Legacy","nodes":[
                   {"id":"stop","type":"function","cat":"terminate","title":"Stop"}]},
                 "paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[],"events":[]}]}
                """;

        assertTrue(read(json).routine().nodes().isEmpty());
        assertThrows(BordeauxRuntimeException.class, () -> readWithRoutine(json));
    }

    @Test
    void waitsForCommandsBeforeChoosingNextPath() throws Exception {
        ObjectNode arguments = (ObjectNode) MAPPER.readTree("{}");
        BordeauxRoutine routine = new BordeauxRoutine("Choose note", List.of(
                new BordeauxRoutineNode.Path("first", "path-a"),
                new BordeauxRoutineNode.Decision("choose", "has-note",
                        List.of(new BordeauxRoutineNode.Command("collect", "collect", arguments),
                                new BordeauxRoutineNode.Command("score", "score", arguments),
                                new BordeauxRoutineNode.Path("a-next", "path-b")),
                        List.of(new BordeauxRoutineNode.Path("b-next", "path-c")))));
        BordeauxPathEvents document = new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), routine,
                Map.of("path-a", List.of(), "path-b", List.of(), "path-c", List.of()));
        boolean[] hasNote = {true};
        List<String> created = new ArrayList<>();
        RecordingScheduler scheduler = new RecordingScheduler();
        BordeauxRoutineRunner runner = new BordeauxRoutineRunner(document, registry(created, "collect", "score"),
                BordeauxConditionRegistry.builder().register("has-note", () -> hasNote[0]).build(), scheduler);

        BordeauxRoutineRunner.Transition firstPath = runner.startTransition();
        assertEquals(BordeauxRoutineRunner.Status.PATH_ACTIVE, firstPath.status());
        assertEquals("path-a", firstPath.pathId().orElseThrow());

        BordeauxRoutineRunner.Transition collecting = runner.completePathTransition("path-a");
        assertEquals(BordeauxRoutineRunner.Status.WAITING_FOR_COMMAND, collecting.status());
        assertTrue(collecting.pathId().isEmpty());
        assertEquals(List.of("collect"), created);
        assertEquals(1, runner.commandCount());
        assertEquals(collecting, runner.periodic());
        assertEquals(List.of("collect"), created);

        scheduler.finish(scheduler.scheduled.get(0));
        BordeauxRoutineRunner.Transition scoring = runner.periodic();
        assertEquals(BordeauxRoutineRunner.Status.WAITING_FOR_COMMAND, scoring.status());
        assertEquals(List.of("collect", "score"), created);
        assertEquals(2, runner.commandCount());
        assertEquals(scoring, runner.periodic());

        scheduler.finish(scheduler.scheduled.get(1));
        BordeauxRoutineRunner.Transition secondPath = runner.periodic();
        assertEquals(BordeauxRoutineRunner.Status.PATH_ACTIVE, secondPath.status());
        assertEquals("path-b", secondPath.pathId().orElseThrow());
        assertEquals(BordeauxRoutineRunner.Status.COMPLETE,
                runner.completePathTransition("path-b").status());

        hasNote[0] = false;
        runner.reset();
        assertEquals("path-a", runner.start().orElseThrow());
        assertEquals("path-c", runner.completePath("path-a").orElseThrow());
        assertThrows(BordeauxRuntimeException.class, () -> runner.completePath("wrong"));
    }

    @Test
    void legacyRoutineMethodsFailFastForCommandWaitsButKeepTrueCompletionEmpty() throws Exception {
        ObjectNode arguments = (ObjectNode) MAPPER.readTree("{}");
        RecordingScheduler scheduler = new RecordingScheduler();
        List<String> created = new ArrayList<>();
        BordeauxCommandRegistry commands = registry(created, "collect");

        BordeauxRoutine startsWithCommand = new BordeauxRoutine("Command first", List.of(
                new BordeauxRoutineNode.Command("collect", "collect", arguments),
                new BordeauxRoutineNode.Path("path", "path-a")));
        BordeauxRoutineRunner startRunner = new BordeauxRoutineRunner(new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), startsWithCommand),
                commands, BordeauxConditionRegistry.empty(), scheduler);

        BordeauxRuntimeException startFailure = assertThrows(BordeauxRuntimeException.class, startRunner::start);
        assertTrue(startFailure.getMessage().contains("startTransition()"));
        assertTrue(startFailure.getMessage().contains("completePathTransition(...)"));
        assertTrue(startFailure.getMessage().contains("periodic()"));
        assertEquals(BordeauxRoutineRunner.Status.READY, startRunner.status());
        assertTrue(created.isEmpty());
        assertTrue(scheduler.scheduled.isEmpty());

        BordeauxRoutine pathThenCommand = new BordeauxRoutine("Command second", List.of(
                new BordeauxRoutineNode.Path("path", "path-a"),
                new BordeauxRoutineNode.Command("collect", "collect", arguments)));
        BordeauxRoutineRunner completeRunner = new BordeauxRoutineRunner(new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), pathThenCommand),
                commands, BordeauxConditionRegistry.empty(), scheduler);

        assertEquals("path-a", completeRunner.start().orElseThrow());
        BordeauxRuntimeException completeFailure = assertThrows(BordeauxRuntimeException.class,
                () -> completeRunner.completePath("path-a"));
        assertTrue(completeFailure.getMessage().contains("completePathTransition(...)"));
        assertEquals(BordeauxRoutineRunner.Status.PATH_ACTIVE, completeRunner.status());
        assertTrue(created.isEmpty());
        assertTrue(scheduler.scheduled.isEmpty());

        BordeauxRoutine pathOnly = new BordeauxRoutine("Path only", List.of(
                new BordeauxRoutineNode.Path("path", "path-a")));
        BordeauxRoutineRunner finishedRunner = new BordeauxRoutineRunner(new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), pathOnly),
                commands, BordeauxConditionRegistry.empty(), scheduler);
        assertEquals("path-a", finishedRunner.start().orElseThrow());
        assertTrue(finishedRunner.completePath("path-a").isEmpty());
        assertEquals(BordeauxRoutineRunner.Status.COMPLETE, finishedRunner.status());

        BordeauxRoutineRunner emptyRunner = new BordeauxRoutineRunner(new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(),
                new BordeauxRoutine("Empty", List.of())), commands, BordeauxConditionRegistry.empty(), scheduler);
        assertTrue(emptyRunner.start().isEmpty());
        assertEquals(BordeauxRoutineRunner.Status.COMPLETE, emptyRunner.status());
    }

    @Test
    void cancelsActiveRoutineCommandOnResetStopAndClose() throws Exception {
        ObjectNode arguments = (ObjectNode) MAPPER.readTree("{}");
        BordeauxRoutine routine = new BordeauxRoutine("Command lifecycle", List.of(
                new BordeauxRoutineNode.Path("first", "path-a"),
                new BordeauxRoutineNode.Command("collect", "collect", arguments),
                new BordeauxRoutineNode.Path("second", "path-b")));
        BordeauxPathEvents document = new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), routine,
                Map.of("path-a", List.of(), "path-b", List.of()));
        RecordingScheduler scheduler = new RecordingScheduler();
        BordeauxRoutineRunner runner = new BordeauxRoutineRunner(document, registry(new ArrayList<>(), "collect"),
                BordeauxConditionRegistry.empty(), scheduler);

        runner.start();
        runner.completePathTransition("path-a");
        Command resetCommand = scheduler.scheduled.get(0);
        runner.reset();
        assertEquals(BordeauxRoutineRunner.Status.READY, runner.status());

        runner.start();
        runner.completePathTransition("path-a");
        Command stopCommand = scheduler.scheduled.get(1);
        runner.stop();
        assertEquals(BordeauxRoutineRunner.Status.STOPPED, runner.status());

        runner.reset();
        runner.start();
        runner.completePathTransition("path-a");
        Command closeCommand = scheduler.scheduled.get(2);
        runner.close();

        assertEquals(List.of(resetCommand, stopCommand, closeCommand), scheduler.cancelled);
        assertEquals(BordeauxRoutineRunner.Status.STOPPED, runner.status());
        assertFalse(scheduler.isScheduled(resetCommand));
        assertFalse(scheduler.isScheduled(stopCommand));
        assertFalse(scheduler.isScheduled(closeCommand));
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
    void completesATerminalPositionWaitUsingTheTrailingTimeSection() {
        List<BordeauxSample> samples = List.of(
                new BordeauxSample(0, 0, 0, 0, 0, 0, 0, 1),
                new BordeauxSample(1, 0.5, 1, 0.5, 1, 0, 0, 1),
                new BordeauxSample(2, 1, 2, 1, 2, 0, 0, 0),
                new BordeauxSample(3, 1.5, 2, 1, 2, 0, 0, 0),
                new BordeauxSample(4, 2, 2, 1, 2, 0, 0, 0));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "terminal-wait", "Terminal wait", 2, CATALOG_ID, HASH, List.of(), samples, List.of(
                        new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 2),
                        new BordeauxFollowSection(0, BordeauxFollowSection.Mode.TIME, 2, 4)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(2, follower.update(0.02, 2, 0).index());
        assertEquals(1, follower.sectionIndex());
        assertFalse(follower.isFinished());
        assertEquals(3, follower.update(0.5, 2, 0).index());
        assertFalse(follower.isFinished());
        assertEquals(4, follower.update(0.5, 2, 0).index());
        assertTrue(follower.isFinished());
    }

    @Test
    void stationaryPositionUpdatesDoNotAdvanceTheLookahead() {
        List<BordeauxSample> samples = List.of(
                sample(0, 0, 0), sample(1, 0.2, 1), sample(2, 0.4, 2),
                sample(3, 0.6, 3), sample(4, 0.8, 4), sample(5, 1, 5));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "position", "Position", 1, CATALOG_ID, HASH, List.of(), samples,
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 5)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(2, follower.update(0.02, 0, 0).index());
        assertEquals(2, follower.update(0.02, 0, 0).index());
        assertEquals(3, follower.update(0.02, 1, 0).index());
    }

    @Test
    void positionFollowingKeepsTheEarliestMonotonicVisitAtSelfOverlaps() {
        List<BordeauxSample> samples = List.of(
                sample(0, 0, 0), sample(1, 0.2, 1), sample(2, 0.4, 0),
                sample(3, 0.6, 2), sample(4, 0.8, 3), sample(5, 1, 0), sample(6, 1.2, 4));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "overlap", "Overlap", 1.2, CATALOG_ID, HASH, List.of(), samples,
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 6)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(3, follower.update(0.02, 1, 0).index());
        assertEquals(4, follower.update(0.02, 0, 0).index());
    }

    @Test
    void positionFollowingDoesNotJumpToANearbyFutureLoopEndpoint() {
        List<BordeauxSample> samples = List.of(
                positionedSample(0, 0, 0), positionedSample(1, 1, 0),
                positionedSample(2, 1, 1), positionedSample(3, 0, 1),
                positionedSample(4, 0.01, 0));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "loop", "Loop", 1, CATALOG_ID, HASH, List.of(), samples,
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 4)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(2, follower.update(0.02, 0.01, 0).index());
        assertFalse(follower.isFinished());
        follower.update(0.02, 1, 0);
        follower.update(0.02, 1, 1);
        follower.update(0.02, 0, 1);
        follower.update(0.02, 0.01, 0);
        assertTrue(follower.isFinished());
    }

    @Test
    void sparsePositionFollowingCanCompleteWithoutFollowingEveryPolylineVertex() {
        List<BordeauxSample> samples = List.of(
                positionedSample(0, 0, 0), positionedSample(1, 1, 0), positionedSample(2, 1, 1));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "sparse", "Sparse", 1, CATALOG_ID, HASH, List.of(), samples,
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 2)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(2, follower.update(0.02, 0, 0).index());
        assertEquals(2, follower.update(0.02, 1, 1).index());
        follower.update(0.02, 1, 1);
        assertTrue(follower.isFinished());
    }

    @Test
    void positionNoiseCannotAccumulateProgressAroundALoop() {
        List<BordeauxSample> samples = List.of(
                positionedSample(0, 0, 0), positionedSample(1, 1, 0),
                positionedSample(2, 1, 1), positionedSample(3, 0, 1),
                positionedSample(4, 0.01, 0));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "noisy-loop", "Noisy loop", 1, CATALOG_ID, HASH, List.of(), samples,
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 4)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        for (int update = 0; update < 200; update++) {
            follower.update(0.02, update % 2 == 0 ? 0 : 0.04, 0);
        }
        assertFalse(follower.isFinished());
        assertEquals(0, follower.sectionIndex());
    }

    @Test
    void positionFollowingAdvancesThroughOnlyCoincidentSamples() {
        List<BordeauxSample> samples = List.of(
                positionedSample(0, 0, 0), positionedSample(1, 0, 0),
                positionedSample(2, 0, 0), positionedSample(3, 1, 0));
        BordeauxPathEvents path = new BordeauxPathEvents(
                "coincident", "Coincident", 1, CATALOG_ID, HASH, List.of(), samples,
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 3)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(3, follower.update(0.02, 0, 0).index());
        assertFalse(follower.isFinished());
        follower.update(0.02, 1, 0);
        assertTrue(follower.isFinished());

        BordeauxPathEvents stationary = new BordeauxPathEvents(
                "stationary", "Stationary", 1, CATALOG_ID, HASH, List.of(), samples.subList(0, 2),
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, 1)));
        BordeauxReferenceFollower stationaryFollower = new BordeauxReferenceFollower(stationary);
        stationaryFollower.update(0.02, 0, 0);
        assertTrue(stationaryFollower.isFinished());
    }

    @Test
    void positionFollowingDoesNotScanEveryRemainingSamplePerUpdate() {
        List<BordeauxSample> samples = new ArrayList<>();
        for (int index = 0; index < 50_000; index++) {
            double x = index / 100.0;
            samples.add(new BordeauxSample(index, index * 0.02, x, index / 49_999.0, x, 0, 0, 1));
        }
        BordeauxPathEvents path = new BordeauxPathEvents(
                "long", "Long", 1_000, CATALOG_ID, HASH, List.of(), samples,
                List.of(new BordeauxFollowSection(0, BordeauxFollowSection.Mode.POSITION, 0, samples.size() - 1)));
        BordeauxReferenceFollower follower = new BordeauxReferenceFollower(path);

        assertEquals(25_002, follower.update(0.02, 250, 0).index());
        assertTrue(follower.lastSearchSamples() < 200,
                "spatial lookup should inspect a bounded subset of a long path");
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

    @Test
    void preflightsEveryEventBeforeAnyCommandFactoryRuns() throws Exception {
        int[] factoryCalls = {0};
        BordeauxCommandRegistry registry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID)
                .catalogHash(HASH)
                .register("exact", Set.of("sequence"),
                        args -> args.requireLong("sequence"), args -> {
                    factoryCalls[0]++;
                    return new TestCommand("exact-" + args.requireLong("sequence"));
                })
                .build();
        ObjectNode valid = (ObjectNode) MAPPER.readTree("{\"sequence\":\"1\"}");
        ObjectNode invalid = (ObjectNode) MAPPER.readTree("{\"sequence\":2}");
        BordeauxPathEvents path = new BordeauxPathEvents(
                "p", "P", 2, CATALOG_ID, HASH, List.of(
                        new BordeauxEvent("early", "Early", 0.1, 0.1, "exact", valid, false),
                        new BordeauxEvent("late", "Late", 1.0, 0.5, "exact", invalid, false)));
        RecordingScheduler scheduler = new RecordingScheduler();

        BordeauxRuntimeException failure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxEventRunner(path, registry, scheduler));

        assertTrue(failure.getMessage().contains("late"));
        assertEquals(0, factoryCalls[0]);
        assertTrue(scheduler.scheduled.isEmpty());

        BordeauxEvent unknownCommand = new BordeauxEvent(
                "unknown", "Unknown", 0.1, 0.1, "missing", valid, false);
        BordeauxRuntimeException missingCommand = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxEventRunner(
                        new BordeauxPathEvents("p", "P", 1, CATALOG_ID, HASH, List.of(unknownCommand)),
                        registry, scheduler));
        assertTrue(missingCommand.getMessage().contains("unknown Bordeaux command ID"));

        BordeauxEvent conditional = new BordeauxEvent(
                "conditional", "Conditional", 0.1, 0.1, "exact", valid, false,
                BordeauxEvent.Trigger.TIME, null, null, "robot.ready");
        BordeauxRuntimeException missingCondition = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxEventRunner(
                        new BordeauxPathEvents("p", "P", 1, CATALOG_ID, HASH, List.of(conditional)),
                        registry, scheduler));
        assertTrue(missingCondition.getMessage().contains("Unknown Bordeaux condition ID"));

        int[] conditionChecks = {0};
        BordeauxEventRunner validRunner = new BordeauxEventRunner(
                new BordeauxPathEvents("p", "P", 1, CATALOG_ID, HASH, List.of(conditional)),
                registry, BordeauxConditionRegistry.builder().register("robot.ready", () -> {
                    conditionChecks[0]++;
                    return true;
                }).build(), scheduler);
        assertEquals(0, factoryCalls[0]);
        assertEquals(0, conditionChecks[0]);
        validRunner.periodic(0.1);
        assertEquals(1, factoryCalls[0]);
        assertEquals(1, conditionChecks[0]);

        BordeauxCommandRegistry legacyRegistry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID).catalogHash(HASH)
                .register("exact", Set.of("sequence"), args -> new TestCommand("legacy"))
                .build();
        BordeauxRuntimeException missingValidator = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxEventRunner(
                        new BordeauxPathEvents("p", "P", 1, CATALOG_ID, HASH, List.of(conditional)),
                        legacyRegistry,
                        BordeauxConditionRegistry.builder().register("robot.ready", () -> true).build(), scheduler));
        assertTrue(missingValidator.getMessage().contains("no side-effect-free argument validator"));
    }

    @Test
    void preflightsCommandsInEveryRoutineBranch() throws Exception {
        int[] factoryCalls = {0};
        BordeauxCommandRegistry registry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID)
                .catalogHash(HASH)
                .register("exact", Set.of("sequence"),
                        args -> args.requireLong("sequence"), args -> {
                    factoryCalls[0]++;
                    return new TestCommand("exact");
                })
                .build();
        BordeauxRoutine routine = new BordeauxRoutine("Routine", List.of(
                new BordeauxRoutineNode.Path("first", "path-a"),
                new BordeauxRoutineNode.Decision("choose", "robot.ready", List.of(), List.of(
                        new BordeauxRoutineNode.Command("late", "exact",
                                (ObjectNode) MAPPER.readTree("{\"sequence\":2}"))))));
        BordeauxPathEvents document = new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), routine);

        BordeauxRuntimeException failure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRoutineRunner(document, registry,
                        BordeauxConditionRegistry.builder().register("robot.ready", () -> true).build(),
                        new RecordingScheduler()));

        assertTrue(failure.getMessage().contains("late"));
        assertEquals(0, factoryCalls[0]);
    }

    @Test
    void preflightsDeepProgrammaticRoutinesWithoutRecursing() {
        BordeauxRoutineNode nested = new BordeauxRoutineNode.Path("path", "path-a");
        for (int depth = 0; depth < 20_000; depth++) {
            nested = new BordeauxRoutineNode.Decision(
                    "decision-" + depth, "robot.ready", List.of(nested), List.of());
        }
        BordeauxRoutine routine = new BordeauxRoutine("Deep routine", List.of(nested));
        BordeauxPathEvents document = new BordeauxPathEvents(
                "path-a", "A", 0, CATALOG_ID, HASH, List.of(), List.of(), List.of(), routine);

        BordeauxRoutineRunner runner = new BordeauxRoutineRunner(
                document,
                BordeauxCommandRegistry.builder().catalogId(CATALOG_ID).catalogHash(HASH).build(),
                BordeauxConditionRegistry.builder().register("robot.ready", () -> true).build(),
                new RecordingScheduler());

        assertEquals(0, runner.commandCount());
    }

    @Test
    void preflightsEventsOnLaterRoutinePathsBeforeTheFirstPathStarts() {
        int[] factoryCalls = {0};
        BordeauxCommandRegistry registry = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID)
                .catalogHash(HASH)
                .register("exact", Set.of("sequence"),
                        args -> args.requireLong("sequence"), args -> {
                    factoryCalls[0]++;
                    return new TestCommand("exact");
                })
                .build();
        BordeauxConditionRegistry conditions = BordeauxConditionRegistry.builder()
                .register("choose-path", () -> true)
                .build();
        RecordingScheduler scheduler = new RecordingScheduler();

        BordeauxPathEvents unknownCommand = readRoutineWithLaterEvent(
                """
                {"eventId":"later","name":"Later","timeS":0.5,"fraction":0.5,
                 "commandId":"missing","arguments":{},"cancelOnPathEnd":false}
                """);
        assertTrue(unknownCommand.events().isEmpty());
        assertEquals(Set.of("path-a", "path-b"), unknownCommand.routinePathEvents().keySet());
        assertThrows(UnsupportedOperationException.class,
                () -> unknownCommand.routinePathEvents().put("other", List.of()));
        assertThrows(UnsupportedOperationException.class,
                () -> unknownCommand.routinePathEvents().get("path-b").clear());
        BordeauxRuntimeException unknownFailure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRoutineRunner(unknownCommand, registry, conditions, scheduler));
        assertTrue(unknownFailure.getMessage().contains("path-b"));
        assertTrue(unknownFailure.getMessage().contains("unknown Bordeaux command ID"));

        BordeauxPathEvents missingMetadata = new BordeauxPathEvents(
                "path-a", "A", 1, CATALOG_ID, HASH, List.of(), List.of(), List.of(), unknownCommand.routine());
        BordeauxRuntimeException metadataFailure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRoutineRunner(missingMetadata, registry, conditions, scheduler));
        assertTrue(metadataFailure.getMessage().contains("path-b"));
        assertTrue(metadataFailure.getMessage().contains("readWithRoutine"));

        BordeauxPathEvents badArguments = readRoutineWithLaterEvent(
                """
                {"eventId":"later","name":"Later","timeS":0.5,"fraction":0.5,
                 "commandId":"exact","arguments":{"sequence":"not-a-number"},"cancelOnPathEnd":false}
                """);
        BordeauxRuntimeException argumentFailure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRoutineRunner(badArguments, registry, conditions, scheduler));
        assertTrue(argumentFailure.getMessage().contains("path-b"));
        assertTrue(argumentFailure.getMessage().contains("sequence"));

        BordeauxPathEvents badCondition = readRoutineWithLaterEvent(
                """
                {"eventId":"later","name":"Later","timeS":0.5,"fraction":0.5,
                 "commandId":"exact","arguments":{"sequence":"2"},"cancelOnPathEnd":false,
                 "conditionId":"missing-condition"}
                """);
        BordeauxRuntimeException conditionFailure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRoutineRunner(badCondition, registry, conditions, scheduler));
        assertTrue(conditionFailure.getMessage().contains("path-b"));
        assertTrue(conditionFailure.getMessage().contains("Unknown Bordeaux condition ID"));

        assertEquals(0, factoryCalls[0]);
        assertTrue(scheduler.scheduled.isEmpty());
    }

    private static BordeauxPathEvents read(String json) {
        return BordeauxTrajectoryReader.read(
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)), "auto");
    }

    private static BordeauxPathEvents readWithRoutine(String json) {
        return BordeauxTrajectoryReader.readWithRoutine(
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)), "auto");
    }

    private static BordeauxPathEvents readRoutineWithLaterEvent(String eventJson) {
        String json = """
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "routine":{"name":"Choose path","nodes":[
                   {"id":"first","type":"path","ref":"path-a"},
                   {"id":"choose","type":"decision","cond":"choose-path","thenLabel":"yes","elseLabel":"no",
                    "then":[{"id":"second","type":"path","ref":"path-b"}],
                    "else":[{"id":"fallback","type":"path","ref":"path-a"}]}]},
                 "paths":[
                   {"id":"path-a","name":"A","totalTimeS":1,"samples":[],"events":[]},
                   {"id":"path-b","name":"B","totalTimeS":1,"samples":[],"events":[%s]}]}
                """.formatted(eventJson);
        return BordeauxTrajectoryReader.readWithRoutine(
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)), "path-a");
    }

    private static BordeauxSample sample(int index, double timeS, double xM) {
        return new BordeauxSample(index, timeS, xM, xM / 4, xM, 0, 0, index == 4 ? 0 : 1);
    }

    private static BordeauxSample positionedSample(int index, double xM, double yM) {
        return new BordeauxSample(index, index * 0.2, index, index / 4.0, xM, yM, 0, index == 4 ? 0 : 1);
    }

    private static BordeauxCommandRegistry registry(List<String> created, String... ids) {
        BordeauxCommandRegistry.Builder builder = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID).catalogHash(HASH);
        for (String id : ids) {
            builder.register(id, Set.of(), args -> {}, args -> {
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
        private final List<Command> active = new ArrayList<>();

        @Override
        public void schedule(Command command) {
            scheduled.add(command);
            active.add(command);
        }

        @Override
        public void cancel(Command command) {
            cancelled.add(command);
            active.remove(command);
        }

        @Override
        public boolean isScheduled(Command command) {
            return active.contains(command);
        }

        private void finish(Command command) {
            if (!active.remove(command)) throw new AssertionError("Command was not scheduled");
        }
    }
}
