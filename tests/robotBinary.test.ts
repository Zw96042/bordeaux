import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BinaryWriter, crc32, encodeBinaryEnvelope } from "../src/shared/export/binaryCodec";
import { buildRobotBinary, encodeBdxArgument } from "../src/shared/export/robotBinary";
import { bdxBindingsFromCatalog } from "../src/electron/bdxBindings";
import { binaryWriterFixture } from "./fixtures/binaryWriterFixture";
import { buildWaypoints } from "../src/shared/project/defaults";
import { buildCanonicalPathState } from "../src/shared/planners/pathState";
import * as pathState from "../src/shared/planners/pathState";
import * as trajectory from "../src/shared/export/robotTrajectory";

const build = (fixture = binaryWriterFixture()) => buildRobotBinary(fixture.project, { kind: "path", id: fixture.path.id }, fixture.bindings);

// Independent cursor checks the published fixed order, sizes, values, and exact consumption.
function inspect(bytes: Uint8Array) {
  const b = Buffer.from(bytes); let offset = 32;
  const u32 = () => { const n = b.readUInt32BE(offset); offset += 4; return n; };
  const u16 = () => { const n = b.readUInt16BE(offset); offset += 2; return n; };
  const dbl = () => { const n = b.readDoubleBE(offset); offset += 8; return n; };
  const text = () => { const length = u32(); const value = b.subarray(offset, offset + length).toString("utf8"); offset += length; return value; };
  const metadataLength = u32(), metadataEnd = offset + metadataLength;
  const strings = Array.from({ length: 8 }, text); expect(u16()).toBe(0); expect(u16()).toBe(0);
  const totals = Array.from({ length: 5 }, dbl); expect(offset).toBe(metadataEnd);
  const samples = Array.from({ length: u32() }, () => Array.from({ length: 11 }, dbl));
  const follow = Array.from({ length: u32() }, () => [u32(), u32(), u32(), u16(), u16()]);
  const events = Array.from({ length: u32() }, () => {
    const end = u32() + offset, ids = Array.from({ length: 4 }, text), schedule = Array.from({ length: 4 }, dbl);
    const trigger = b[offset++], cancel = b[offset++]; expect(u16()).toBe(0);
    const args = Array.from({ length: u32() }, () => {
      const key = text(), tag = u16(); expect(u16()).toBe(0); const size = u32(); const raw = b.subarray(offset, offset + size); offset += size; return { key, tag, raw };
    }); expect(offset).toBe(end); return { ids, schedule, trigger, cancel, args };
  }); expect(offset).toBe(b.length); return { strings, totals, samples, follow, events };
}

describe("direct VI binary path", () => {
  it("writes the BE header, exact payload length and published CRC vector", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    const bytes = Buffer.from(encodeBinaryEnvelope(Buffer.from([1, 2, 3])));
    expect(bytes.subarray(0, 8).toString()).toBe("BDXLV1\r\n"); expect(bytes.readUInt16BE(8)).toBe(1);
    expect(bytes.readUInt16BE(10)).toBe(0); expect(bytes.readUInt32BE(12)).toBe(32); expect(bytes.readUInt32BE(16)).toBe(3);
    expect(bytes.readUInt32BE(20)).toBe(crc32(bytes.subarray(32))); expect(bytes.subarray(24, 32)).toEqual(Buffer.alloc(8));
    expect(() => new BinaryWriter(2).bytes(Buffer.alloc(3))).toThrow(/exceeds/);
  });
  it("exports an unlinked eventless selected path without runtime profiles or an NI catalog", () => {
    const fixture = binaryWriterFixture(false, false); fixture.bindings = bdxBindingsFromCatalog(null);
    fixture.project.paths.push({ ...fixture.path, id: "unrelated", waypoints: [] });
    const built = build(fixture), decoded = inspect(built.bytes);
    expect(decoded.strings.slice(6)).toEqual(["", ""]); expect(decoded.events).toHaveLength(0);
    expect(built.document.paths).toHaveLength(1); expect(built.document.routine).toBeNull(); expect(built).not.toHaveProperty("runtimeReady");
    expect(build(fixture).bytes).toEqual(built.bytes);
  });
  it("preserves full samples, separate canonical travel direction, follow sections, schedules and raw NI argument widths", () => {
    const fixture = binaryWriterFixture(true), built = build(fixture), decoded = inspect(built.bytes), path = built.document.paths[0];
    expect(decoded.strings[0]).toBe(fixture.path.id); expect(decoded.strings[6]).toBe(fixture.bindings.catalog.catalogId);
    const tangents = buildCanonicalPathState(fixture.path, path.samples).points.map((p) => p.tangentRad);
    expect(decoded.samples).toEqual(path.samples.map((s, i) => [s.t, s.s, s.f, s.x, s.y, s.headingRad, tangents[i], s.velocityMps, s.accelerationMps2, s.angularVelocityRadps, s.curvatureInvM]));
    expect(decoded.follow).toEqual(path.followSections.map((s) => [s.segmentIndex, s.startSample, s.endSample, s.mode === "time" ? 0 : 1, 0]));
    expect(decoded.events[1].schedule).toEqual([path.events[1].timeS, 0.6, 0.2, -1]); expect(decoded.events[1].trigger).toBe(1);
    expect(decoded.events[0].args.map((a) => a.tag)).toEqual([1, 11, 6, 8, 14, 12]);
    expect(decoded.events[0].args[3].raw.readBigInt64BE()).toBe(9007199254740993n); expect(decoded.events[0].args[4].raw.readUInt16BE()).toBe(1);
    expect(decoded.events[0].args[5].raw.toString()).toBe("Café 🤖");
  });
  it("preserves equal-due authored order and permits the default sequential marker group", () => {
    const f = binaryWriterFixture(); f.path.markers[0].id = "z-first"; f.path.markers[1].id = "a-second";
    f.path.markers[1].f = f.path.markers[0].f;
    expect(inspect(build(f).bytes).events.map((event) => event.ids[0])).toEqual(["z-first", "a-second"]);
    f.path.markers[0].group = "parallel"; expect(() => build(f)).toThrow(/parallel groups/);
  });
  it("requires saved NI evidence for commands and fails explicitly for unsupported compound arguments", () => {
    const f = binaryWriterFixture(); delete f.bindings.parameterTypes["fixture.command"];
    expect(() => build(f)).toThrow(/saved NI parameter type evidence/);
    for (const niType of ["Array", "Cluster", "Variant"]) expect(() => encodeBdxArgument({ niType }, {})).toThrow(/not supported/);
  });
  it("encodes every primitive NI representation exactly and rejects overflow/lossy integers", () => {
    const cases: Array<[string, unknown, string]> = [["I8", -128, "80"], ["U8", 255, "ff"], ["I16", -32768, "8000"], ["U16", 65535, "ffff"], ["I32", -2147483648, "80000000"], ["U32", "4294967295", "ffffffff"], ["I64", "-9223372036854775808", "8000000000000000"], ["U64", "18446744073709551615", "ffffffffffffffff"], ["SGL", 1.5, "3fc00000"], ["DBL", -0, "8000000000000000"], ["Boolean", false, "00"], ["String", "a\0b", "610062"]];
    for (const [niType, value, hex] of cases) expect(encodeBdxArgument({ niType }, value).bytes.toString("hex")).toBe(hex);
    expect(encodeBdxArgument({ niType: "DBL" }, 1e20).bytes.readDoubleBE()).toBe(1e20);
    for (const [niType, value] of [["U16", 65536], ["U64", 9007199254740993], ["I64", "9223372036854775808"], ["SGL", 1e100], ["DBL", NaN], ["String", "\ud800"]] as const) expect(() => encodeBdxArgument({ niType }, value)).toThrow();
    for (const [niType, tag, width] of [["EB", 13, 1], ["EW", 14, 2], ["EL", 15, 4]] as const) { const a = encodeBdxArgument({ niType, choices: ["Off", "On"] }, "On"); expect(a.tag).toBe(tag); expect(a.bytes.length).toBe(width); }
  });
  it("retains stationary zero-duration and duplicate initial time samples", () => {
    const f = binaryWriterFixture(false, false);
    f.path.waypoints = buildWaypoints([{ x: 2.2, y: 4, theta: 0, segType: "bezier" }, { x: 2.2, y: 4, theta: 0 }]);
    const built = build(f); expect(built.document.paths[0].totalTimeS).toBe(0); expect(inspect(built.bytes).samples.length).toBeGreaterThan(2);
  });
});

// Linux CI differed from the Mac fixtures by at most two ULP in sample doubles. Check its numerical
// agreement separately, then feed canonical numbers through the real serializer
// so the golden check still covers every byte, including lengths, CRC and SHA.
function buildAgainstGolden(fixture: ReturnType<typeof binaryWriterFixture>, golden: Uint8Array) {
  const built = build(fixture), actual = inspect(built.bytes), expected = inspect(golden);
  const agree = (value: number, reference: number) => {
    expect(Math.abs(value - reference)).toBeLessThanOrEqual(2 * Number.EPSILON * Math.max(1, Math.abs(reference)));
    return reference;
  };
  expect(actual.samples.length).toBe(expected.samples.length);
  expect(actual.events.length).toBe(expected.events.length);
  const document = structuredClone(built.document), selected = document.paths[0];
  selected.totalTimeS = agree(selected.totalTimeS, expected.totals[0]);
  selected.totalDistanceM = agree(selected.totalDistanceM, expected.totals[1]);
  const canonical = buildCanonicalPathState(fixture.path, selected.samples);
  const sampleKeys = ["t", "s", "f", "x", "y", "headingRad", null, "velocityMps", "accelerationMps2", "angularVelocityRadps", "curvatureInvM"] as const;
  selected.samples.forEach((sample, index) => {
    sampleKeys.forEach((key, column) => {
      const value = agree(actual.samples[index][column], expected.samples[index][column]);
      if (key) sample[key] = value;
      else canonical.points[index].tangentRad = value;
    });
  });
  selected.events.forEach((event, index) => {
    event.timeS = agree(event.timeS, expected.events[index].schedule[0]);
    if (event.endTimeS !== undefined) event.endTimeS = agree(event.endTimeS, expected.events[index].schedule[3]);
  });
  const trajectorySpy = vi.spyOn(trajectory, "buildRobotTrajectory").mockReturnValue({ ...built, document });
  const canonicalSpy = vi.spyOn(pathState, "buildCanonicalPathState").mockReturnValue(canonical);
  try { return build(fixture); }
  finally { trajectorySpy.mockRestore(); canonicalSpy.mockRestore(); }
}

it("tolerates planner rounding while rejecting meaningful changes to golden sample values", () => {
  const fixture = binaryWriterFixture(false, false), golden = Buffer.from(build(fixture).bytes);
  const secondSampleTime = 32 + 4 + golden.readUInt32BE(32) + 4 + 11 * 8;
  golden.writeBigUInt64BE(golden.readBigUInt64BE(secondSampleTime) + 1n, secondSampleTime);
  golden.writeUInt32BE(crc32(golden.subarray(32)), 20);
  expect(Buffer.from(buildAgainstGolden(fixture, golden).bytes)).toEqual(golden);
  golden.writeDoubleBE(golden.readDoubleBE(secondSampleTime) + 1e-7, secondSampleTime);
  golden.writeUInt32BE(crc32(golden.subarray(32)), 20);
  expect(() => buildAgainstGolden(fixture, golden)).toThrow();
});

it("keeps golden header, CRC and non-planner metadata comparisons exact", () => {
  const fixture = binaryWriterFixture(false, false), original = Buffer.from(build(fixture).bytes);
  for (const offset of [0, 20, 40]) {
    const corrupted = Buffer.from(original);
    corrupted[offset] ^= 1;
    const rebuilt = buildAgainstGolden(fixture, corrupted);
    expect(Buffer.from(rebuilt.bytes)).not.toEqual(corrupted);
  }
});

// Deliberate regeneration: BORDEAUX_UPDATE_BDX_FIXTURES=1 npx vitest run tests/robotBinary.test.ts
it("matches the direct-VI golden files and normalized fixture evidence", () => {
  const directory = path.resolve("labview/tests/fixtures/binary");
  const manifest: unknown[] = [];
  for (const [name, curved, events] of [["straight-empty", false, false], ["straight-events", false, true], ["curve-events", true, true]] as const) {
    const fixture = binaryWriterFixture(curved, events);
    const built = process.env.BORDEAUX_UPDATE_BDX_FIXTURES === "1" ? build(fixture)
      : buildAgainstGolden(fixture, fs.readFileSync(path.join(directory, name + ".bdx")));
    const decoded = inspect(built.bytes);
    const expected = JSON.stringify({ format: "BDXLV1", testOnly: true, sha256: built.sha256, byteLength: built.bytes.length,
      metadata: { pathId: decoded.strings[0], pathName: decoded.strings[1], plannerId: decoded.strings[2], fieldId: decoded.strings[3], fieldRevision: decoded.strings[4], coordinateSchemaId: decoded.strings[5], commandCatalogId: decoded.strings[6], commandCatalogHash: decoded.strings[7], driveType: 0,
        totalTimeS: decoded.totals[0], totalDistanceM: decoded.totals[1], robotWidthM: decoded.totals[2], robotLengthM: decoded.totals[3], robotMaxSpeedMps: decoded.totals[4] },
      samples: decoded.samples, followSections: decoded.follow, events: decoded.events.map((event) => ({ ...event, args: event.args.map((argument) => ({ key: argument.key, tag: argument.tag, hex: argument.raw.toString("hex") })) })) }, null, 2) + "\n";
    if (process.env.BORDEAUX_UPDATE_BDX_FIXTURES === "1") { fs.writeFileSync(path.join(directory, name + ".bdx"), built.bytes); fs.writeFileSync(path.join(directory, name + ".expected.json"), expected); }
    expect(fs.readFileSync(path.join(directory, name + ".bdx"))).toEqual(Buffer.from(built.bytes));
    expect(fs.readFileSync(path.join(directory, name + ".expected.json"), "utf8")).toBe(expected);
    manifest.push({ name, sha256: built.sha256, bytes: built.bytes.length });
  }
  if (process.env.BORDEAUX_UPDATE_BDX_FIXTURES === "1") {
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ format: "BDXLV1", testOnly: true, fixtures: manifest }, null, 2) + "\n");
    fs.writeFileSync(path.join(directory, "TEST-ONLY.command-types.json"), binaryWriterFixture().bindings.definitionJson + "\n");
  } else {
    expect(JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"))).toEqual({ format: "BDXLV1", testOnly: true, fixtures: manifest });
  }
});
