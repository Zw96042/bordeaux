package frc.robot;

import dev.bordeaux.runtime.BordeauxBindings;
import dev.bordeaux.runtime.BordeauxCommandRegistry;
import dev.bordeaux.runtime.BordeauxPathEvents;
import dev.bordeaux.runtime.BordeauxPathRunner;
import dev.bordeaux.runtime.BordeauxSample;
import dev.bordeaux.runtime.BordeauxTrajectoryReader;
import edu.wpi.first.wpilibj.Filesystem;
import java.io.IOException;
import java.nio.file.Files;

// Illustrative team-owned wiring. Bordeaux never edits RobotContainer.
public final class RobotContainerSnippet {
    private final RobotCommands actions;
    private final Drivetrain drivetrain;
    private final BordeauxCommandRegistry bordeauxCommands;
    private BordeauxPathRunner bordeauxPath;

    public RobotContainerSnippet(RobotCommands.Superstructure superstructure, Drivetrain drivetrain) {
        actions = new RobotCommands(superstructure);
        this.drivetrain = drivetrain;
        bordeauxCommands = BordeauxBindings.generated(actions);
    }

    public void startPath(String fileName, String pathId) throws IOException {
        try (var input = Files.newInputStream(Filesystem.getDeployDirectory().toPath().resolve(fileName))) {
            BordeauxPathEvents path = BordeauxTrajectoryReader.read(input, pathId);
            bordeauxPath = new BordeauxPathRunner(path, bordeauxCommands);
        }
    }

    // Call from the team-owned path Command.execute(). The same update advances the
    // reference and fires annotated commands using actual, not lookahead, progress.
    public boolean pathPeriodic(double dtS) {
        if (bordeauxPath == null) return false;
        BordeauxSample reference = bordeauxPath.update(
                dtS, drivetrain.xM(), drivetrain.yM(), drivetrain.measuredPathFraction());
        drivetrain.follow(reference);
        return !bordeauxPath.isFinished();
    }

    public void endPath() {
        if (bordeauxPath != null) bordeauxPath.end();
        bordeauxPath = null;
        drivetrain.stop();
    }

    public interface Drivetrain {
        double xM();
        double yM();
        double measuredPathFraction();
        void follow(BordeauxSample reference);
        void stop();
    }
}
