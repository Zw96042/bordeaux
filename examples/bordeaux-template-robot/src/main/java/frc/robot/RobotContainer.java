package frc.robot;

import dev.bordeaux.runtime.BordeauxBindings;
import dev.bordeaux.runtime.BordeauxCommandRegistry;
import dev.bordeaux.runtime.BordeauxEventRunner;
import dev.bordeaux.runtime.BordeauxPathEvents;
import dev.bordeaux.runtime.BordeauxTrajectoryReader;
import edu.wpi.first.wpilibj.Filesystem;
import frc.robot.commands.ExampleCommands;
import frc.robot.subsystems.ExampleSubsystem;
import java.io.IOException;
import java.nio.file.Files;

public final class RobotContainer {
    private final ExampleSubsystem exampleSubsystem = new ExampleSubsystem();
    private final ExampleCommands exampleCommands = new ExampleCommands(exampleSubsystem);
    private final BordeauxCommandRegistry commandRegistry =
            BordeauxBindings.generated(exampleCommands);

    private BordeauxEventRunner eventRunner;
    private double pathDurationS;

    public void startBordeauxPath(String fileName, String pathIdOrName) throws IOException {
        endBordeauxPath();
        var trajectory = Filesystem.getDeployDirectory().toPath()
                .resolve("bordeaux")
                .resolve(fileName);
        try (var input = Files.newInputStream(trajectory)) {
            BordeauxPathEvents path = BordeauxTrajectoryReader.read(input, pathIdOrName);
            eventRunner = new BordeauxEventRunner(path, commandRegistry);
            pathDurationS = path.totalTimeS();
        }
    }

    /** Processes the final event tick before applying path-end cancellation. */
    public boolean pollBordeauxEvents(double elapsedS) {
        if (eventRunner == null) return false;
        eventRunner.periodic(elapsedS);
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
