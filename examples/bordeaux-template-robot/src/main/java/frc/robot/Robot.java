package frc.robot;

import dev.bordeaux.runtime.BordeauxRuntimeException;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.TimedRobot;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj2.command.CommandScheduler;
import java.io.IOException;

public final class Robot extends TimedRobot {
    private static final String TRAJECTORY_FILE = "Untitled.bordeaux.json";
    private static final String PATH_SELECTOR = "NewPath";

    private final Timer autonomousTimer = new Timer();
    private RobotContainer container;
    private boolean bordeauxPathActive;

    @Override
    public void robotInit() {
        container = new RobotContainer();
    }

    @Override
    public void robotPeriodic() {
        CommandScheduler.getInstance().run();
    }

    @Override
    public void autonomousInit() {
        stopBordeauxPath();
        try {
            container.startBordeauxPath(TRAJECTORY_FILE, PATH_SELECTOR);
            autonomousTimer.restart();
            bordeauxPathActive = true;
        } catch (IOException | BordeauxRuntimeException exception) {
            DriverStation.reportError("Could not start Bordeaux path: " + exception.getMessage(), false);
        }
    }

    @Override
    public void autonomousPeriodic() {
        if (!bordeauxPathActive) return;
        try {
            // A real robot passes the same elapsed time to its drivetrain path follower.
            bordeauxPathActive = container.pollBordeauxEvents(autonomousTimer.get());
            if (!bordeauxPathActive) autonomousTimer.stop();
        } catch (BordeauxRuntimeException exception) {
            DriverStation.reportError("Bordeaux event failed: " + exception.getMessage(), false);
            stopBordeauxPath();
        }
    }

    @Override
    public void teleopInit() {
        stopBordeauxPath();
    }

    @Override
    public void disabledInit() {
        stopBordeauxPath();
    }

    @Override
    public void testInit() {
        stopBordeauxPath();
        CommandScheduler.getInstance().cancelAll();
    }

    private void stopBordeauxPath() {
        autonomousTimer.stop();
        if (container != null) container.endBordeauxPath();
        bordeauxPathActive = false;
    }
}
