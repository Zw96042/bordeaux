package frc.robot.commands;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;

import frc.robot.subsystems.ExampleSubsystem;
import org.junit.jupiter.api.Test;

final class ExampleCommandsTest {
    @Test
    void factoriesReturnFreshCommands() {
        var subsystem = new ExampleSubsystem();
        var commands = new ExampleCommands(subsystem);

        var first = commands.holdOutput(0.25);
        var second = commands.holdOutput(0.25);

        assertNotNull(first);
        assertNotNull(commands.printMessage("test"));
        assertNotNull(commands.setOutput(new ExampleCommands.OutputRequest(0.5, ExampleCommands.Signal.READY)));
        assertNotSame(first, second);
    }
}
