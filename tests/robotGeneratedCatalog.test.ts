import { describe, expect, it } from "vitest";
import { generatedCatalogHash, parseGeneratedRobotCatalog } from "../src/electron/robotGeneratedCatalog";

function catalog() {
  const value = {
    schemaVersion: "1.0",
    catalogId: "competition-robot",
    supportVersion: "0.1.0",
    catalogHash: "",
    commands: [{
      id: "frc.robot.AutoCommands#score",
      label: "Score",
      description: "Scores a selected level.",
      aliases: ["shoot", "score"],
      semanticTags: ["shoot-fuel"],
      ownerType: "frc.robot.AutoCommands",
      member: "score",
      kind: "factory",
      confidence: "confirmed",
      parameters: [{
        name: "target",
        label: "Target",
        description: "Authored scoring target.",
        valueType: "frc.robot.Target",
        role: "argument",
        schema: {
          kind: "object",
          valueType: "frc.robot.Target",
          fields: [
            { name: "level", schema: { kind: "enum", valueType: "frc.robot.Level", enumValues: ["L1", "L4"] } },
            { name: "sequence", schema: { kind: "integerString", valueType: "I64" } },
          ],
        },
        defaultValue: { level: "L4", sequence: "9007199254740993" },
      }, {
        name: "precise",
        valueType: "robot.math.BigDecimal",
        role: "argument",
        schema: { kind: "decimalString", valueType: "robot.math.BigDecimal" },
        defaultValue: "0.10000000000000000001",
        min: "0.10000000000000000000",
        max: "0.10000000000000000002",
      }],
      source: { file: "Commands/AutoCommands.vi", line: 17 },
    }],
  };
  value.catalogHash = generatedCatalogHash(value.commands);
  return value;
}

describe("generated Robot command catalogs", () => {
  it("accepts a 1.1 catalog whose identity covers sorted condition capabilities", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.2.0";
    value.conditions = [{
      id: "frc.robot.Conditions#hasNote",
      label: "Has note",
      description: "The robot currently holds a note.",
      aliases: ["note", "piece"],
      semanticTags: ["game-piece"],
      ownerType: "frc.robot.Conditions",
      member: "hasNote",
      source: { file: "Commands/Conditions.vi", line: 14 },
    }, {
      id: "frc.robot.Conditions#ready",
      label: "Ready",
      ownerType: "frc.robot.Conditions",
      member: "ready",
      source: { file: "Commands/Conditions.vi", line: 9 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    const parsed = parseGeneratedRobotCatalog(value);

    expect(parsed.schemaVersion).toBe("1.1");
    expect(parsed.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "frc.robot.Conditions#hasNote", semanticTags: ["game-piece"] }),
    ]));
    expect(generatedCatalogHash(value.commands, [...value.conditions].reverse())).not.toBe(value.catalogHash);
  });

  it("normalizes the processor's unknown condition source line", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.2.0";
    value.conditions = [{
      id: "frc.robot.Conditions#ready",
      label: "Ready",
      ownerType: "frc.robot.Conditions",
      member: "ready",
      source: { file: "frc/robot/Conditions.vi", line: 0 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(parseGeneratedRobotCatalog(value).conditions[0].source.line).toBe(1);
  });

  it("accepts locale-independent condition ordering", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.2.0";
    value.conditions = ["a#B", "a.B"].map((id) => ({
      id,
      label: id,
      ownerType: "frc.robot.Conditions",
      member: "ready",
      source: { file: "frc/robot/Conditions.vi", line: 0 },
    }));
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(parseGeneratedRobotCatalog(value).conditions.map((condition) => condition.id)).toEqual(["a#B", "a.B"]);
  });

  it("rejects command and condition IDs that collide", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.2.0";
    value.conditions = [{
      id: value.commands[0].id,
      label: "Collision",
      ownerType: "frc.robot.Conditions",
      member: "collision",
      source: { file: "frc/robot/Conditions.vi", line: 0 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(() => parseGeneratedRobotCatalog(value)).toThrow(/capability ID.*collides/);
  });

  it("rejects 1.1 catalogs with duplicate, unsorted, or malformed conditions", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.2.0";
    value.conditions = [{
      id: "frc.robot.Conditions#ready",
      label: "Ready",
      ownerType: "frc.robot.Conditions",
      member: "ready",
      source: { file: "Commands/Conditions.vi", line: 9 },
    }, {
      id: "frc.robot.Conditions#hasNote",
      label: "Has note",
      ownerType: "frc.robot.Conditions",
      member: "hasNote",
      source: { file: "Commands/Conditions.vi", line: 14 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);
    expect(() => parseGeneratedRobotCatalog(value)).toThrow(/sorted/);

    value.conditions.reverse();
    value.conditions.push({ ...value.conditions[0] });
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);
    expect(() => parseGeneratedRobotCatalog(value)).toThrow(/duplicated/);

    value.conditions = [{ ...value.conditions[0], aliases: Array.from({ length: 17 }, (_, index) => `alias-${index}`) }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);
    expect(() => parseGeneratedRobotCatalog(value)).toThrow(/aliases/);
  });

  it("requires the 1.1 catalog and 0.2.0 runtime contract together", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.1.0";
    value.conditions = [];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(() => parseGeneratedRobotCatalog(value)).toThrow(/schema 1\.1 requires its matching supported runtime version/);
  });

  it("continues to parse a legacy 1.0 command-only catalog", () => {
    expect(parseGeneratedRobotCatalog(catalog())).toMatchObject({ schemaVersion: "1.0", conditions: [] });
  });

  it("accepts bounded metadata and exact custom defaults", () => {
    const { commands: [command], catalogHash } = parseGeneratedRobotCatalog(catalog());

    expect(command).toMatchObject({
      id: "frc.robot.AutoCommands#score",
      description: "Scores a selected level.",
      aliases: ["shoot", "score"],
      semanticTags: ["shoot-fuel"],
      runtimeReady: true,
    });
    expect(command.parameters[0]).toMatchObject({
      name: "target",
      label: "Target",
      defaultValue: { level: "L4", sequence: "9007199254740993" },
    });
    expect(catalogHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(command.parameters[1]).toMatchObject({
      min: "0.10000000000000000000",
      max: "0.10000000000000000002",
    });
  });

  it("rejects duplicate IDs and defaults that do not match the generated schema", () => {
    const duplicate = catalog();
    duplicate.commands.push(structuredClone(duplicate.commands[0]));
    duplicate.catalogHash = generatedCatalogHash(duplicate.commands);
    expect(() => parseGeneratedRobotCatalog(duplicate)).toThrow(/duplicated/);

    const invalidDefault = catalog();
    invalidDefault.commands[0].parameters[0].defaultValue = { level: "L9", sequence: "1" };
    invalidDefault.catalogHash = generatedCatalogHash(invalidDefault.commands);
    expect(() => parseGeneratedRobotCatalog(invalidDefault)).toThrow(/default.*enum values/);
  });

  it("rejects malformed and excessively deep schemas", () => {
    const invalid = catalog() as any;
    let schema = invalid.commands[0].parameters[0].schema;
    for (let depth = 0; depth < 26; depth += 1) {
      schema.kind = "optional";
      schema.element = { kind: "optional", valueType: "Optional<String>" };
      schema = schema.element;
    }
    invalid.catalogHash = generatedCatalogHash(invalid.commands);
    expect(() => parseGeneratedRobotCatalog(invalid)).toThrow(/exceeds 24 levels/);
  });

  it("rejects inverted exact bounds without converting them to binary floats", () => {
    const invalid = catalog();
    invalid.commands[0].parameters[1].min = "0.10000000000000000003";
    invalid.catalogHash = generatedCatalogHash(invalid.commands);
    expect(() => parseGeneratedRobotCatalog(invalid)).toThrow(/inverted range/);
  });

  it("rejects generated defaults outside their authored bounds", () => {
    const invalid = catalog();
    invalid.commands[0].parameters[1].defaultValue = "0.2";
    invalid.catalogHash = generatedCatalogHash(invalid.commands);
    expect(() => parseGeneratedRobotCatalog(invalid)).toThrow(/default.*at most/);
  });
});
