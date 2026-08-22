package dev.bordeaux.examples.commands;

import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;

import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import org.junit.jupiter.api.Test;

class ExistingCommandProviderTest {
    @Test
    void preservesExistingInstancesAndUsesFactoriesForFreshCommands() {
        Command existing = Commands.none();
        var provider = new ExistingCommandProvider(existing, Commands::none, output -> Commands.none());

        assertSame(existing, provider.alignCommand);
        assertNotSame(provider.autonomousCommand.get(), provider.autonomousCommand.get());
        assertNotSame(provider.runIntake(0.5), provider.runIntake(0.5));
    }
}
