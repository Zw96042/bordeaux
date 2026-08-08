package frc.robot.commands;

import dev.bordeaux.annotations.BordeauxCommand;
import dev.bordeaux.annotations.BordeauxParam;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import frc.robot.subsystems.ExampleSubsystem;

public final class ExampleCommands {
    public enum Signal {
        READY,
        SCORE,
        STOPPED
    }

    public record OutputRequest(double output, Signal signal) {}

    private final ExampleSubsystem subsystem;

    public ExampleCommands(ExampleSubsystem subsystem) {
        this.subsystem = subsystem;
    }

    @BordeauxCommand(
            id = "example.print-message",
            label = "Print message",
            description = "Prints a message from a trajectory event")
    public Command printMessage(
            @BordeauxParam(label = "Message", defaultValue = "\"Hello from Bordeaux\"") String message) {
        return Commands.runOnce(() -> System.out.println("[Bordeaux] " + message));
    }

    @BordeauxCommand(
            id = "example.set-output",
            label = "Set output",
            description = "Applies one structured output request")
    public Command setOutput(
            @BordeauxParam(
                    label = "Request",
                    description = "Normalized output and dashboard signal",
                    defaultValue = "{\"output\":0.35,\"signal\":\"READY\"}")
                    OutputRequest request) {
        return Commands.runOnce(() -> {
            subsystem.setOutput(request.output());
            subsystem.setStatus(request.signal().name());
        }, subsystem);
    }

    @BordeauxCommand(
            id = "example.hold-output",
            label = "Hold output",
            description = "Runs until canceled; select Cancel at path end for this event")
    public Command holdOutput(
            @BordeauxParam(
                    label = "Normalized output",
                    description = "Signed motor-style output from -1 to 1",
                    defaultValue = "0.25",
                    min = "-1",
                    max = "1")
                    double output) {
        return Commands.startEnd(
                () -> subsystem.setOutput(output),
                subsystem::stop,
                subsystem);
    }

    @BordeauxCommand(
            id = "example.set-status",
            label = "Set status",
            description = "Selects a discovered Java enum value")
    public Command setStatus(
            @BordeauxParam(label = "Signal", defaultValue = "\"SCORE\"") Signal signal) {
        return Commands.runOnce(() -> subsystem.setStatus(signal.name()), subsystem);
    }
}
