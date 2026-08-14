import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Routine authoring remains a legacy JavaScript module.
import { AUTO } from "../src/renderer/lib/routineModel";

describe("authoritative routine conditions", () => {
  it("offers only linked generated conditions and starts decisions blank", () => {
    const conditions = AUTO.authoritativeConditions({
      authoritative: true,
      generatedSchemaVersion: "1.1",
      conditions: [{ id: "robot.conditions#ready", label: "Ready", description: "Robot is ready." }],
    });

    expect(conditions).toEqual([{ value: "robot.conditions#ready", label: "Ready", meta: "Robot is ready." }]);
    expect(AUTO.newNode("decision").cond).toBe("");
    expect(AUTO.conditionPickerItems(conditions, "")).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "" }),
      expect.objectContaining({ value: "robot.conditions#ready" }),
    ]));
  });

  it("keeps an unavailable saved condition visible, invalid, and replaceable", () => {
    const items = AUTO.conditionPickerItems([], "legacy.ready");

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "", label: "Choose a registered condition" }),
      expect.objectContaining({ value: "legacy.ready", badge: "invalid" }),
    ]));
    expect(AUTO.authoritativeConditions({ authoritative: true, generatedSchemaVersion: "1.0", conditions: [{ id: "legacy.ready" }] })).toEqual([]);
  });

  it("wires the linked catalog's condition options into the routine inspector", () => {
    const appSource = fs.readFileSync(path.join(process.cwd(), "src/renderer/app/App.jsx"), "utf8");

    expect(appSource).toContain("conditionOptions: AUTO.authoritativeConditions(javaProjectState.catalog)");
  });
});
