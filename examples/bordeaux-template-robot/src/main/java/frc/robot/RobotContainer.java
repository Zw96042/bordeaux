package frc.robot;

import dev.bordeaux.runtime.BordeauxBindings;
import dev.bordeaux.runtime.BordeauxCapabilities;
import dev.bordeaux.runtime.BordeauxEventRunner;
import dev.bordeaux.runtime.BordeauxPathEvents;
import dev.bordeaux.runtime.BordeauxRuntimeCompatibility;
import dev.bordeaux.runtime.BordeauxTrajectoryReader;
import edu.wpi.first.wpilibj.Filesystem;
import frc.robot.commands.ExampleCommands;
import frc.robot.paths.DynamicPaths;
import frc.robot.subsystems.ExampleSubsystem;
import java.io.IOException;
import java.nio.file.Files;

public final class RobotContainer {
    private static final String SUPPORT_VERSION = "0.4.0";
    private static final String FIELD_ID = "2026-rebuilt";
    private static final String FIELD_REVISION = "2026-manual-tu19-welded-4";
    private static final String FIELD_COORDINATE_SCHEMA_ID = "bordeaux-field/1.0";

    private final ExampleSubsystem exampleSubsystem = new ExampleSubsystem();
    private final ExampleCommands exampleCommands = new ExampleCommands(exampleSubsystem);
    private final DynamicPaths dynamicPaths = new DynamicPaths();
    private final BordeauxCapabilities bordeauxCapabilities =
            BordeauxBindings.generatedCapabilities(exampleCommands, dynamicPaths);
    private final BordeauxRuntimeCompatibility bordeauxCompatibility = new BordeauxRuntimeCompatibility(
            bordeauxCapabilities.catalogId(),
            bordeauxCapabilities.catalogHash(),
            SUPPORT_VERSION,
            FIELD_ID,
            FIELD_REVISION,
            FIELD_COORDINATE_SCHEMA_ID);

    private BordeauxEventRunner eventRunner;
    private double pathDurationS;

    public void startBordeauxPath(String fileName, String pathIdOrName) throws IOException {
        endBordeauxPath();
        var trajectory = Filesystem.getDeployDirectory().toPath()
                .resolve("bordeaux")
                .resolve(fileName);
        BordeauxPathEvents path;
        try (var input = Files.newInputStream(trajectory)) {
            path = BordeauxTrajectoryReader.read(input, pathIdOrName, bordeauxCompatibility);
        }
        eventRunner = new BordeauxEventRunner(path, bordeauxCapabilities);
        pathDurationS = path.totalTimeS();
    }

    /** Simulation-only fallback: estimates progress from time and owns planned completion. */
    public boolean pollBordeauxEvents(double elapsedS) {
        double plannedFraction = pathDurationS > 0
                ? Math.max(0, Math.min(1, elapsedS / pathDurationS))
                : 0;
        return pollBordeauxEvents(elapsedS, plannedFraction);
    }

    /** Processes the final event tick using monotonic measured path progress from 0 to 1. */
    public boolean pollBordeauxEvents(double elapsedS, double measuredFraction) {
        if (eventRunner == null) return false;
        eventRunner.periodic(elapsedS, measuredFraction);
        return finishPathIfDue(elapsedS);
    }

    /** Processes events while a real follower remains the sole owner of path completion. */
    public void updateBordeauxEvents(double elapsedS, double measuredFraction) {
        if (eventRunner == null) return;
        eventRunner.periodic(elapsedS, measuredFraction);
    }

    private boolean finishPathIfDue(double elapsedS) {
        if (elapsedS + 1e-9 >= pathDurationS) {
            endBordeauxPath();
            return false;
        }
        return true;
    }

    public void endBordeauxPath() {
        if (eventRunner != null) eventRunner.endPath();
        eventRunner = null;
        pathDurationS = 0;
    }

    public ExampleSubsystem exampleSubsystem() {
        return exampleSubsystem;
    }
}
