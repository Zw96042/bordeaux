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
    ]);
    expect(catalog.warnings).toEqual([]);
  });

  it("ignores fake declarations in comments and strings and identifies overloads stably", async () => {
    const project = await temporaryProject();
    await writeJava(project, "Commands.java", `
      package frc.robot;
      import edu.wpi.first.wpilibj2.command.Command;
      import edu.wpi.first.wpilibj2.command.CommandBase;
      public final class Commands {
        // public Command fake(double speed) { return null; }
        private final String sample = "public class FakeCommand extends CommandBase {}";
        public Command align(int target) { return null; }
        public Command align(String target) { return null; }
        private Command hidden() { return null; }
      }

      final class HiddenCommand extends CommandBase {
        private HiddenCommand() {}
      }
    `);

    const catalog = await discoverJavaProject(project);

    expect(catalog.commands.map((command) => command.id)).toEqual([
      "frc.robot.Commands#align(int)",
      "frc.robot.Commands#align(String)",
    ]);
  });

  it("reports opaque custom types without dropping the command", async () => {
    const project = await temporaryProject();
    await writeJava(project, "MysteryFactory.java", `
      package frc.robot;
      import edu.wpi.first.wpilibj2.command.Command;
      public final class MysteryFactory {
        public Command configure(ExternalConfig config) { return null; }
      }
    `);

    const catalog = await discoverJavaProject(project);

    expect(catalog.commands[0].parameters[0]).toMatchObject({
      name: "config",
      role: "argument",
      schema: { kind: "opaque", javaType: "ExternalConfig" },
    });
    expect(catalog.warnings).toContain("Configure: config uses unresolved custom type ExternalConfig");
  });

  it("prefers generated bindings while retaining source-only discoveries", async () => {
    const project = await temporaryProject();
    await writeJava(project, "AutoCommands.java", `
      package frc.robot;
      import edu.wpi.first.wpilibj2.command.Command;
      public final class AutoCommands {
        public Command score(int level, String label) { return null; }
        public Command intake() { return null; }
      }
    `);
    await fs.mkdir(path.join(project, "build/bordeaux"), { recursive: true });
    const commands = [{
      id: "auto.score",
      label: "Score at level",
      ownerType: "frc.robot.AutoCommands",
      member: "score",
      kind: "factory",
      confidence: "confirmed",
      parameters: [
        { name: "label", label: "Label", javaType: "java.lang.String", role: "argument", schema: { kind: "string", javaType: "java.lang.String" } },
        { name: "level", label: "Level", javaType: "int", role: "argument", schema: { kind: "integer", javaType: "int" } },
      ],
    }];
    await fs.writeFile(path.join(project, "build/bordeaux/catalog-v1.json"), JSON.stringify({
      schemaVersion: "1.0",
      catalogId: "robot-test",
      supportVersion: "0.1.0",
      catalogHash: generatedCatalogHash(commands),
      commands,
    }));

    const catalog = await discoverJavaProject(project);

    expect(catalog.source).toBe("mixed");
    expect(catalog.runtimeCommandCount).toBe(1);
    expect(catalog.commands).toHaveLength(2);
    expect(catalog.commands.find((command) => command.id === "auto.score")).toMatchObject({ label: "Score at level", runtimeReady: true });
    expect(catalog.commands.some((command) => command.id.endsWith("#score"))).toBe(false);
    expect(catalog.commands.find((command) => command.id.endsWith("#intake"))).toMatchObject({ runtimeReady: false });
