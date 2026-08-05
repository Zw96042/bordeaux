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
