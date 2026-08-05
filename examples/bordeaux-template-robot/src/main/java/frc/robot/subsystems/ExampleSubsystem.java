package frc.robot.subsystems;

import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.SubsystemBase;

public final class ExampleSubsystem extends SubsystemBase {
    private double output;
    private String status = "Idle";

    public void setOutput(double output) {
        this.output = Math.max(-1.0, Math.min(1.0, output));
    }

    public void stop() {
        output = 0;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public double output() {
        return output;
    }

    public String status() {
        return status;
    }

    @Override
    public void periodic() {
        SmartDashboard.putNumber("Bordeaux Example/Output", output);
        SmartDashboard.putString("Bordeaux Example/Status", status);
    }
}
