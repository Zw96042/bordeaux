import { describe, expect, it } from "vitest";
import { generatedCatalogHash, parseGeneratedJavaCatalog } from "../src/electron/javaGeneratedCatalog";

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
        javaType: "frc.robot.Target",
        role: "argument",
        schema: {
          kind: "object",
          javaType: "frc.robot.Target",
          fields: [
            { name: "level", schema: { kind: "enum", javaType: "frc.robot.Level", enumValues: ["L1", "L4"] } },
            { name: "sequence", schema: { kind: "integerString", javaType: "long" } },
          ],
        },
        defaultValue: { level: "L4", sequence: "9007199254740993" },
      }, {
        name: "precise",
        javaType: "java.math.BigDecimal",
        role: "argument",
        schema: { kind: "decimalString", javaType: "java.math.BigDecimal" },
        defaultValue: "0.10000000000000000001",
        min: "0.10000000000000000000",
        max: "0.10000000000000000002",
      }],
      source: { file: "src/main/java/frc/robot/AutoCommands.java", line: 17 },
    }],
  };
  value.catalogHash = generatedCatalogHash(value.commands);
  return value;
}

describe("generated Java command catalogs", () => {
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
      source: { file: "src/main/java/frc/robot/Conditions.java", line: 14 },
    }, {
      id: "frc.robot.Conditions#ready",
      label: "Ready",
      ownerType: "frc.robot.Conditions",
      member: "ready",
      source: { file: "src/main/java/frc/robot/Conditions.java", line: 9 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    const parsed = parseGeneratedJavaCatalog(value);

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
      source: { file: "frc/robot/Conditions.java", line: 0 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(parseGeneratedJavaCatalog(value).conditions[0].source.line).toBe(1);
  });

  it("accepts the annotation processor's locale-independent condition order", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.2.0";
    value.conditions = ["a#B", "a.B"].map((id) => ({
      id,
      label: id,
      ownerType: "frc.robot.Conditions",
      member: "ready",
      source: { file: "frc/robot/Conditions.java", line: 0 },
    }));
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(parseGeneratedJavaCatalog(value).conditions.map((condition) => condition.id)).toEqual(["a#B", "a.B"]);
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
      source: { file: "frc/robot/Conditions.java", line: 0 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(() => parseGeneratedJavaCatalog(value)).toThrow(/capability ID.*collides/);
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
      source: { file: "src/main/java/frc/robot/Conditions.java", line: 9 },
    }, {
      id: "frc.robot.Conditions#hasNote",
      label: "Has note",
      ownerType: "frc.robot.Conditions",
      member: "hasNote",
      source: { file: "src/main/java/frc/robot/Conditions.java", line: 14 },
    }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);
    expect(() => parseGeneratedJavaCatalog(value)).toThrow(/sorted/);

    value.conditions.reverse();
    value.conditions.push({ ...value.conditions[0] });
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);
    expect(() => parseGeneratedJavaCatalog(value)).toThrow(/duplicated/);

    value.conditions = [{ ...value.conditions[0], aliases: Array.from({ length: 17 }, (_, index) => `alias-${index}`) }];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);
    expect(() => parseGeneratedJavaCatalog(value)).toThrow(/aliases/);
  });

  it("requires the 1.1 catalog and 0.2.0 runtime contract together", () => {
    const value = catalog() as any;
    value.schemaVersion = "1.1";
    value.supportVersion = "0.1.0";
    value.conditions = [];
    value.catalogHash = generatedCatalogHash(value.commands, value.conditions);

    expect(() => parseGeneratedJavaCatalog(value)).toThrow(/schema 1\.1 requires its matching supported runtime version/);
  });

  it("continues to parse a legacy 1.0 command-only catalog", () => {
    expect(parseGeneratedJavaCatalog(catalog())).toMatchObject({ schemaVersion: "1.0", conditions: [] });
  });

  it("accepts bounded metadata and exact custom defaults", () => {
    const { commands: [command], catalogHash } = parseGeneratedJavaCatalog(catalog());

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
    expect(() => parseGeneratedJavaCatalog(duplicate)).toThrow(/duplicated/);

    const invalidDefault = catalog();
    invalidDefault.commands[0].parameters[0].defaultValue = { level: "L9", sequence: "1" };
    invalidDefault.catalogHash = generatedCatalogHash(invalidDefault.commands);
    expect(() => parseGeneratedJavaCatalog(invalidDefault)).toThrow(/default.*enum values/);
  });

  it("rejects malformed and excessively deep schemas", () => {
    const invalid = catalog() as any;
    let schema = invalid.commands[0].parameters[0].schema;
    for (let depth = 0; depth < 26; depth += 1) {
      schema.kind = "optional";
      schema.element = { kind: "optional", javaType: "java.util.Optional<java.lang.String>" };
      schema = schema.element;
    }
    invalid.catalogHash = generatedCatalogHash(invalid.commands);
    expect(() => parseGeneratedJavaCatalog(invalid)).toThrow(/exceeds 24 levels/);
  });

  it("rejects inverted exact bounds without converting them to binary floats", () => {
    const invalid = catalog();
    invalid.commands[0].parameters[1].min = "0.10000000000000000003";
    invalid.catalogHash = generatedCatalogHash(invalid.commands);
    expect(() => parseGeneratedJavaCatalog(invalid)).toThrow(/inverted range/);
  });

  it("rejects generated defaults outside their authored bounds", () => {
    const invalid = catalog();
    invalid.commands[0].parameters[1].defaultValue = "0.2";
    invalid.catalogHash = generatedCatalogHash(invalid.commands);
    expect(() => parseGeneratedJavaCatalog(invalid)).toThrow(/default.*at most/);
  });
});
