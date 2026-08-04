package frc.robot;

import dev.bordeaux.runtime.BordeauxBindings;
import dev.bordeaux.runtime.BordeauxCommandRegistry;
import dev.bordeaux.runtime.BordeauxEventRunner;
import dev.bordeaux.runtime.BordeauxPathEvents;
import dev.bordeaux.runtime.BordeauxTrajectoryReader;
import edu.wpi.first.wpilibj.Filesystem;
import java.io.IOException;
import java.nio.file.Files;

// Illustrative team-owned wiring. Bordeaux never edits RobotContainer.
public final class RobotContainerSnippet {
    private final RobotCommands actions;
    private final BordeauxCommandRegistry bordeauxCommands;
    private BordeauxEventRunner bordeauxEvents;

    public RobotContainerSnippet(RobotCommands.Superstructure superstructure) {
        actions = new RobotCommands(superstructure);
        bordeauxCommands = BordeauxBindings.generated(actions);
    }

    public void startPath(String fileName, String pathId) throws IOException {
        try (var input = Files.newInputStream(Filesystem.getDeployDirectory().toPath().resolve(fileName))) {
            BordeauxPathEvents path = BordeauxTrajectoryReader.read(input, pathId);
            bordeauxEvents = new BordeauxEventRunner(path, bordeauxCommands);
        }
    }

    // Pass the same elapsed time used by the path follower from robotPeriodic/autonomousPeriodic.
    public void pathPeriodic(double elapsedS) {
        if (bordeauxEvents != null) bordeauxEvents.periodic(elapsedS);
    }

    public void endPath() {
        if (bordeauxEvents != null) bordeauxEvents.endPath();
        bordeauxEvents = null;
    }
}
