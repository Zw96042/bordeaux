import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverJavaProject, readableJavaProjectError } from "../src/electron/javaProject";
import { generatedCatalogHash } from "../src/electron/javaGeneratedCatalog";

const temporaryDirectories: string[] = [];

async function temporaryProject(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-java-project-"));
  temporaryDirectories.push(directory);
  await fs.mkdir(path.join(directory, "src/main/java/frc/robot"), { recursive: true });
  await fs.writeFile(path.join(directory, "build.gradle"), "plugins { id 'java' }\n");
  await fs.writeFile(path.join(directory, "settings.gradle"), "rootProject.name = 'CompetitionRobot'\n");
  return directory;
}

async function writeJava(project: string, name: string, contents: string): Promise<void> {
  await fs.writeFile(path.join(project, "src/main/java/frc/robot", name), contents);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Java command project discovery", () => {
  it("discovers command constructors, factories, and recursive custom parameter types", async () => {
    const project = await temporaryProject();
    await writeJava(project, "ScoreCommand.java", `
      package frc.robot;
      import edu.wpi.first.wpilibj2.command.CommandBase;
      import java.util.List;

      public final class ScoreCommand extends CommandBase {
        public ScoreCommand(ShooterSubsystem shooter, ShotConfig config, int repetitions, long sequenceNumber) {}
      }

      record ShotConfig(double rpm, HoodAngle angle, List<String> tags) {}
      enum HoodAngle { LOW, MID, HIGH }
      final class ShooterSubsystem {}
    `);
    await writeJava(project, "RobotContainer.java", `
      package frc.robot;
      import edu.wpi.first.wpilibj2.command.Command;
      import java.math.BigDecimal;
      import java.util.Map;
      import java.util.Optional;

      public final class RobotContainer {
        public Command intake(boolean fast, Map<String, Double> gains, Optional<TargetPose> target, BigDecimal tolerance) { return null; }
      }

      final class TargetPose {
        public TargetPose(double x, double y) {}
      }
    `);

    const catalog = await discoverJavaProject(project);

    expect(catalog.projectName).toBe("CompetitionRobot");
    expect(catalog.sourceFileCount).toBe(2);
    expect(catalog.commands.map((command) => command.id)).toEqual([
      "frc.robot.RobotContainer#intake",
      "frc.robot.ScoreCommand",
    ]);
    const score = catalog.commands.find((command) => command.id === "frc.robot.ScoreCommand")!;
    expect(score.parameters[0]).toMatchObject({ name: "shooter", role: "dependency" });
    expect(score.parameters[1]).toMatchObject({
      name: "config",
      role: "argument",
      schema: {
        kind: "object",
        javaType: "frc.robot.ShotConfig",
        fields: [
          { name: "rpm", schema: { kind: "number" } },
          { name: "angle", schema: { kind: "enum", enumValues: ["LOW", "MID", "HIGH"] } },
          { name: "tags", schema: { kind: "array", element: { kind: "string" } } },
        ],
      },
    });
    expect(score.parameters[2]).toMatchObject({ name: "repetitions", schema: { kind: "integer" } });
    expect(score.parameters[3]).toMatchObject({ name: "sequenceNumber", schema: { kind: "integerString" } });

    const intake = catalog.commands.find((command) => command.id === "frc.robot.RobotContainer#intake")!;
    expect(intake.parameters).toMatchObject([
      { name: "fast", schema: { kind: "boolean" } },
      { name: "gains", schema: { kind: "map", value: { kind: "number" } } },
      { name: "target", schema: { kind: "optional", element: { kind: "object", fields: [{ name: "x" }, { name: "y" }] } } },
      { name: "tolerance", schema: { kind: "decimalString" } },
