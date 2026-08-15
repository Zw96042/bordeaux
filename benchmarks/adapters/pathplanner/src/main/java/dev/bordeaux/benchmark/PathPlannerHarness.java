package dev.bordeaux.benchmark;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.pathplanner.lib.config.ModuleConfig;
import com.pathplanner.lib.config.RobotConfig;
import com.pathplanner.lib.path.GoalEndState;
import com.pathplanner.lib.path.PathConstraints;
import com.pathplanner.lib.path.PathPlannerPath;
import com.pathplanner.lib.path.PathPoint;
import com.pathplanner.lib.path.RotationTarget;
import edu.wpi.first.hal.HAL;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Translation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.math.system.plant.DCMotor;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class PathPlannerHarness {
    private static final String TOOL_VERSION = "2026.1.2";
    private static final String WPILIB_VERSION = "2026.1.1";
    private static final String JAVA_VERSION = "17";

    private PathPlannerHarness() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            throw new IllegalArgumentException("Usage: PathPlannerHarness <request.json> <raw-output.json>");
        }
        System.setProperty("java.awt.headless", "true");
        HAL.initialize(500, 0);

        ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
        Request request = mapper.readValue(Path.of(args[0]).toFile(), Request.class);
        validateRequest(request);

        ModuleConfig module = new ModuleConfig(
                request.robot.wheelRadiusM,
                request.robot.moduleMaxSpeedMps,
                request.robot.wheelCoefficientOfFriction,
                DCMotor.getNEO(1),
                request.robot.driveGearing,
                request.robot.driveCurrentLimitA,
                1);
        double halfLength = request.robot.bumperLengthM / 2;
        double halfWidth = request.robot.bumperWidthM / 2;
        RobotConfig robot = new RobotConfig(
                request.robot.massKg,
                request.robot.momentOfInertiaKgM2,
                module,
                new Translation2d(halfLength, halfWidth),
                new Translation2d(halfLength, -halfWidth),
                new Translation2d(-halfLength, halfWidth),
                new Translation2d(-halfLength, -halfWidth));

        List<PathPoint> points = new ArrayList<>();
        for (int index = 0; index < request.path.points.size(); index++) {
            Point point = request.path.points.get(index);
            PathConstraints constraints = new PathConstraints(
                    point.maxVelocityMps,
                    point.maxAccelerationMps2,
                    point.maxAngularVelocityRadps,
                    point.maxAngularAccelerationRadps2);
            boolean isRotationTarget = index > 0
                    && (index % request.path.rotationTargetStride == 0
                            || index == request.path.points.size() - 1);
            PathPoint pathPoint = new PathPoint(
                    new Translation2d(point.x, point.y),
                    isRotationTarget
                            ? new RotationTarget(index, Rotation2d.fromRadians(point.headingRad))
                            : null,
                    constraints);
            pathPoint.waypointRelativePos = index;
            points.add(pathPoint);
        }
        Point firstPoint = request.path.points.get(0);
        PathConstraints globalConstraints = new PathConstraints(
                firstPoint.maxVelocityMps,
                firstPoint.maxAccelerationMps2,
                firstPoint.maxAngularVelocityRadps,
                firstPoint.maxAngularAccelerationRadps2);
        PathPlannerPath path = PathPlannerPath.fromPathPoints(
                points,
                globalConstraints,
                new GoalEndState(
                        request.path.goalVelocityMps,
                        Rotation2d.fromRadians(request.path.goalRobotHeadingRad)));

        ChassisSpeeds startSpeeds = ChassisSpeeds.fromFieldRelativeSpeeds(
                request.path.startVelocityMps * Math.cos(request.path.startTravelHeadingRad),
                request.path.startVelocityMps * Math.sin(request.path.startTravelHeadingRad),
                0,
                Rotation2d.fromRadians(request.path.startRobotHeadingRad));
        var trajectory = path.generateTrajectory(
                startSpeeds,
                Rotation2d.fromRadians(request.path.startRobotHeadingRad),
                robot);

        List<State> states = trajectory.getStates().stream()
                .map(state -> new State(
                        state.timeSeconds,
                        state.pose.getX(),
                        state.pose.getY(),
                        state.pose.getRotation().getRadians(),
                        state.fieldSpeeds.vxMetersPerSecond,
                        state.fieldSpeeds.vyMetersPerSecond,
                        state.fieldSpeeds.omegaRadiansPerSecond))
                .toList();
        RawOutput output = new RawOutput(
                "bordeaux-pathplanner-raw/1.0",
                TOOL_VERSION,
                WPILIB_VERSION,
                System.getProperty("java.runtime.version"),
                states,
                List.of());
        String contents = mapper.writeValueAsString(output) + "\n";
        Files.writeString(Path.of(args[1]), contents);
    }

    private static void validateRequest(Request request) {
        if (!"bordeaux-pathplanner-request/1.0".equals(request.schemaVersion)
                || request.tool == null
                || !"PathPlannerLib".equals(request.tool.name)
                || !TOOL_VERSION.equals(request.tool.version)
                || !WPILIB_VERSION.equals(request.tool.wpilibVersion)
                || !JAVA_VERSION.equals(request.tool.javaVersion)
                || Runtime.version().feature() != Integer.parseInt(JAVA_VERSION)
                || request.path == null
                || request.path.points == null
                || request.path.points.size() < 2
                || request.path.rotationTargetStride < 1) {
            throw new IllegalArgumentException("Request does not match the pinned PathPlanner adapter contract.");
        }
    }

    public static final class Request {
        public String schemaVersion;
        public JsonNode fixture;
        public Tool tool;
        public JsonNode mapping;
        public Robot robot;
        public RequestPath path;
    }

    public static final class Tool {
        public String name;
        public String version;
        public String wpilibVersion;
        public String javaVersion;
    }

    public static final class Robot {
        public double massKg;
        public double momentOfInertiaKgM2;
        public double bumperWidthM;
        public double bumperLengthM;
        public double wheelRadiusM;
        public double moduleMaxSpeedMps;
        public double wheelCoefficientOfFriction;
        public String driveMotor;
        public double driveGearing;
        public double driveCurrentLimitA;
    }

    public static final class RequestPath {
        public double startVelocityMps;
        public double goalVelocityMps;
        public double startTravelHeadingRad;
        public double startRobotHeadingRad;
        public double goalRobotHeadingRad;
        public int rotationTargetStride;
        public List<Point> points;
    }

    public static final class Point {
        public double x;
        public double y;
        public double headingRad;
        public double maxVelocityMps;
        public double maxAccelerationMps2;
        public double maxAngularVelocityRadps;
        public double maxAngularAccelerationRadps2;
    }

    public record State(
            double timeSeconds,
            double x,
            double y,
            double headingRad,
            double velocityXMps,
            double velocityYMps,
            double angularVelocityRadps) {}

    public record Event(String id, double timeS) {}

    public record RawOutput(
            String schemaVersion,
            String toolVersion,
            String wpilibVersion,
            String javaRuntimeVersion,
            List<State> states,
            List<Event> events) {}
}
