package dev.bordeaux.examples.commands;

import dev.bordeaux.annotations.BordeauxCommand;
import dev.bordeaux.annotations.BordeauxParam;
import edu.wpi.first.wpilibj2.command.Command;
import java.util.Objects;
import java.util.function.DoubleFunction;
import java.util.function.Supplier;

/** Exposes existing commands; use suppliers when independent or overlapping lifecycles are possible. */
public final class ExistingCommandProvider {
    @BordeauxCommand(id = "drive.align", label = "Align to target")
    public final Command alignCommand;

    @BordeauxCommand(id = "auto.existing", label = "Run existing auto")
    public final Supplier<Command> autonomousCommand;

    private final DoubleFunction<Command> intakeFactory;

    public ExistingCommandProvider(
            Command alignCommand,
            Supplier<Command> autonomousCommand,
            DoubleFunction<Command> intakeFactory) {
        this.alignCommand = Objects.requireNonNull(alignCommand, "alignCommand");
        this.autonomousCommand = Objects.requireNonNull(autonomousCommand, "autonomousCommand");
        this.intakeFactory = Objects.requireNonNull(intakeFactory, "intakeFactory");
    }

    @BordeauxCommand(
            id = "intake.run",
            label = "Run intake",
            description = "Calls the same parameterized factory used by the robot")
    public Command runIntake(
            @BordeauxParam(label = "Output", defaultValue = "0.65", min = "-1", max = "1")
                    double output) {
        return Objects.requireNonNull(intakeFactory.apply(output), "intakeFactory result");
    }
}
