package frc.robot;

import dev.bordeaux.runtime.BordeauxBindings;
import dev.bordeaux.runtime.BordeauxCapabilities;
import dev.bordeaux.runtime.BordeauxEventRunner;
import dev.bordeaux.runtime.BordeauxPathEvents;
import dev.bordeaux.runtime.BordeauxRuntimeCompatibility;
import dev.bordeaux.runtime.BordeauxTrajectoryReader;
import edu.wpi.first.wpilibj.Filesystem;
import java.io.IOException;
import java.nio.file.Files;

// Illustrative team-owned wiring. Bordeaux never edits RobotContainer.
public final class RobotContainerSnippet {
    private static final String FIELD_ID = "2026-rebuilt";
    private static final String FIELD_REVISION = "2026-manual-tu19-welded-4";
    private static final String FIELD_COORDINATE_SCHEMA_ID = "bordeaux-field/1.0";

    private final RobotCommands actions;
    private final BordeauxCapabilities bordeauxCapabilities;
    private final BordeauxRuntimeCompatibility bordeauxCompatibility;
    private BordeauxEventRunner bordeauxEvents;

    public RobotContainerSnippet(RobotCommands.Superstructure superstructure) {
        actions = new RobotCommands(superstructure);
        bordeauxCapabilities = BordeauxBindings.generatedCapabilities(actions);
        bordeauxCompatibility = new BordeauxRuntimeCompatibility(
                bordeauxCapabilities.catalogId(),
                bordeauxCapabilities.catalogHash(),
                "0.4.0",
                FIELD_ID,
                FIELD_REVISION,
                FIELD_COORDINATE_SCHEMA_ID);
    }

    public void startPath(String fileName, String pathId) throws IOException {
        // Starting a replacement intentionally applies the prior path's cancellation policy first.
        endPath();
        var trajectory = Filesystem.getDeployDirectory().toPath()
                .resolve("bordeaux")
                .resolve(fileName);
        BordeauxPathEvents path;
        try (var input = Files.newInputStream(trajectory)) {
            path = BordeauxTrajectoryReader.read(input, pathId, bordeauxCompatibility);
        }
        bordeauxEvents = new BordeauxEventRunner(path, bordeauxCapabilities);
    }

    // Pass the follower's elapsed time and monotonic measured progress from 0 to 1.
    public void pathPeriodic(double elapsedS, double measuredFraction) {
        if (bordeauxEvents != null) bordeauxEvents.periodic(elapsedS, measuredFraction);
    }

    public void pathPeriodic(double elapsedS, double measuredFraction) {
        if (bordeauxEvents != null) bordeauxEvents.periodic(elapsedS, measuredFraction);
    }

    public void endPath() {
        if (bordeauxEvents != null) bordeauxEvents.endPath();
        bordeauxEvents = null;
    }
}
