package frc.robot;

import dev.bordeaux.annotations.BordeauxCommand;
import dev.bordeaux.annotations.BordeauxCondition;
import dev.bordeaux.annotations.BordeauxParam;
import edu.wpi.first.wpilibj2.command.Command;
import java.util.List;
import java.util.function.Supplier;

public final class RobotCommands {
    public enum Level { L1, L2, L3, L4 }

    public record ScoreTarget(Level level, List<Integer> branches) {}

    private final Superstructure superstructure;

    // Reuse one instance only when its trigger/chooser and Bordeaux ownership are mutually exclusive.
    @BordeauxCommand(id = "superstructure.intake", label = "Run intake")
    public final Command intakeCommand;

    // Use a supplier when every invocation should construct a fresh command.
    @BordeauxCommand(id = "superstructure.home", label = "Home superstructure")
    public final Supplier<Command> homeCommand;

    public RobotCommands(Superstructure superstructure) {
        this.superstructure = superstructure;
        intakeCommand = superstructure.intakeCommand();
        homeCommand = superstructure::homeCommand;
    }

    @BordeauxCommand(
            id = "superstructure.score",
            label = "Score game piece",
            description = "Moves to the selected target and releases",
            aliases = {"shoot", "score"},
            semanticTags = {"shoot-fuel"})
    public Command score(
            @BordeauxParam(label = "Target") ScoreTarget target,
            @BordeauxParam(label = "Release delay", unit = "s", defaultValue = "0.1", min = "0", max = "1.5")
                    double releaseDelayS) {
        return superstructure.score(target.level(), target.branches(), releaseDelayS);
    }

    @BordeauxCondition(id = "superstructure.ready-to-score", label = "Ready to score")
    public boolean readyToScore() {
        return superstructure.readyToScore();
    }

    // This placeholder represents the team's existing subsystem/API.
    public interface Superstructure {
        Command score(Level level, List<Integer> branches, double releaseDelayS);

        Command intakeCommand();

        Command homeCommand();

        boolean readyToScore();
    }
}
