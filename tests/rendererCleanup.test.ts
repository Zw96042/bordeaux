import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
// @ts-expect-error The production worker is an intentional JavaScript module.
import { processPathPreviewJob } from "../src/renderer/assets/path-preview-worker";
// @ts-expect-error The inspector is a JavaScript component.
import { parameterValueError } from "../src/renderer/components/ContextInspector";
// @ts-expect-error The editor panels are JavaScript components.
import { Panels } from "../src/renderer/components/Panels";
import { createDemoProject } from "../src/shared/project/defaults";
import { robotParameterValueError } from "../src/shared/robotCommands";
import type { RobotCommandParameter, RobotValueSchema } from "../src/shared/types";

describe("timeline marker timing", () => {
  it("places an endpoint marker after the endpoint wait, matching the exported time", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints.at(-1)!.stop = true;
    path.waypoints.at(-1)!.wait = 0.5;
    path.markers = [{ id: "marker_end", f: 1, name: "Endpoint event", cmd: "none", group: "sequential" }];

    const preview = processPathPreviewJob({ id: 1, quality: "final", path, robot: project.robot, perSegment: 56 });
    expect(preview.error).toBeUndefined();
    const derived = preview.value;
    expect(derived.prof.t.at(-1)).toBeLessThan(derived.prof.totalTime - 0.4);
    expect(derived.markers).toEqual([expect.objectContaining({ id: "marker_end", timeS: derived.finalTrajectory.totalTimeS })]);

    const html = renderToString(React.createElement(Panels.Transport, {
      derived, doc: path, metric: "velocity", setMetric() {}, playTime: 0, playing: false,
      togglePlayback() {}, seek() {}, restart() {}, graphOpen: false, setGraphOpen() {},
    }));
    expect(html).toMatch(/class="timeline-event" title="Endpoint event" aria-hidden="true" style="left:100\.000%"/);
  });
});

describe("inspector command argument validation", () => {
  const u32: RobotValueSchema = { kind: "integerString", valueType: "U32" };
  const decimal: RobotValueSchema = { kind: "decimalString", valueType: "DBL" };
  const custom: RobotValueSchema = { kind: "opaque", valueType: "Cluster" };
  const cases: Array<[string, RobotValueSchema, unknown, boolean, Pick<RobotCommandParameter, "min" | "max">?]> = [
    ["a negative U32 exact integer", u32, "-1", false],
    ["the U32 exact integer maximum", u32, "4294967295", true],
    ["a U32 exact integer overflow", u32, "4294967296", false],
    ["an I64 exact integer underflow", { kind: "integerString", valueType: "I64" }, "-9223372036854775809", false],
    ["an exact decimal exponent overflow", decimal, "1e10001", false],
    ["an exact decimal below its minimum", decimal, "2.5", false, { min: 3 }],
    ["an exact decimal at its minimum", decimal, "3.0", true, { min: 3 }],
    ["a JSON custom value", custom, { gain: 1 }, true],
    ["a non-JSON custom value", custom, { gain: Infinity }, false],
    ["a U8 overflow", { kind: "integer", valueType: "U8" }, 256, false],
    ["a number above its maximum", { kind: "number", valueType: "DBL" }, 5, false, { max: 4 }],
    ["an undiscovered cluster field", { kind: "object", valueType: "Cluster", fields: [{ name: "x", schema: { kind: "number", valueType: "DBL" } }] }, { x: 1, y: 2 }, false],
  ];

  it.each(cases)("agrees with export validation for %s", (_, schema, value, valid, limits = {}) => {
    const parameter: RobotCommandParameter = { name: "value", label: "Value", valueType: schema.valueType, role: "argument", schema, ...limits };
    const exported = robotParameterValueError(value, parameter);
    expect(exported === null).toBe(valid);
    expect(parameterValueError(value, parameter)).toBe(valid ? "" : exported + ".");
  });

  it("also rejects nested SGL values that the export encoder cannot represent", () => {
    const schema: RobotValueSchema = { kind: "array", valueType: "Array", element: { kind: "number", valueType: "SGL" } };
    const parameter: RobotCommandParameter = { name: "power", label: "Power", valueType: "Array", role: "argument", schema };
    expect(robotParameterValueError([1, 1e40], parameter)).toBeNull();
    expect(parameterValueError([1, 1e40], parameter)).toBe("Power[1] must fit the SGL range.");
    expect(parameterValueError([1, 1e30], parameter)).toBe("");
  });
});
