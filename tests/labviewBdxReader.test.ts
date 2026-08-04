import { describe, expect, it } from "vitest";

import { buildLabviewBdx } from "../src/shared/export/labviewBdx";
import {
  LabviewBdxParseError,
  LabviewBdxUnsupportedError,
  parseLabviewBdx,
} from "../src/shared/export/labviewBdxReader";
import { createDemoProject } from "../src/shared/project/defaults";

function u8(value: number): Buffer {
  return Buffer.from([value]);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function i32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function f64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleBE(value);
  return buffer;
}

function labviewString(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  return Buffer.concat([u32(encoded.length), encoded]);
}

function buildIndependentSentinel(): Buffer {
  return Buffer.concat([
    labviewString("4.4"),
    u8(1),
    u8(0),
    u32(1),
    labviewString("Sentinel"),
    u16(3),
    u32(1),
    f64(1.25),
    f64(-2.5),
    f64(33.75),
    u32(1),
    f64(4.25),
    f64(-5.5),
    f64(6.75),
    f64(-7.875),
    i32(-8),
    i32(9),
    u32(0),
    f64(0.125),
    f64(10.1),
    f64(20.2),
    f64(30.3),
    f64(40.4),
    f64(-1.1),
    f64(2.2),
    u32(0),
    f64(50.5),
    f64(60.6),
    f64(70.7),
    u32(1),
    f64(80.8),
    f64(-90.9),
    f64(100.01),
    f64(110.11),
    f64(120.12),
    u8(1),
    u16(0),
    u16(1),
    u8(1),
    f64(130.13),
    u8(0),
    u8(1),
  ]);
}

function commandCountOffset(buffer: Buffer): number {
  let offset = 9; // Version string and the two reverse flags.
  const segmentCount = buffer.readUInt32BE(offset);
  offset += 4;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const nameLength = buffer.readUInt32BE(offset);
    offset += 4 + nameLength + 2;
    const positionCount = buffer.readUInt32BE(offset);
    offset += 4 + positionCount * 24;
    const velocityCount = buffer.readUInt32BE(offset);
    offset += 4 + velocityCount * 32 + 8;
  }
  return offset;
}

describe("LabVIEW Bordeaux v4.4 reader", () => {
  it("decodes an independently constructed sentinel stream", () => {
    expect(parseLabviewBdx(buildIndependentSentinel())).toEqual({
      version: "4.4",
      robotBackwards: true,
      reversePath: false,
      trajectory: [
        {
          name: "Sentinel",
          typeCode: 3,
          type: "circle",
          positions: [{ xFt: 1.25, yFt: -2.5, headingDeg: 33.75 }],
          velocities: [
            {
              velocityFps: 4.25,
              omegaDegPerS: -5.5,
              vectorYFps: 6.75,
              vectorXFps: -7.875,
            },
          ],
          accelIndex: -8,
          decelIndex: 9,
        },
      ],
      commands: [],
      conditions: {
        samplePeriodS: 0.125,
        limits: {
          velocityFps: 10.1,
          accelerationFps2: 20.2,
          jerkFps3: 30.3,
          stoopidFastFps: 40.4,
        },
        initialVelocityFps: -1.1,
        finalVelocityFps: 2.2,
        overrides: [],
        angularLimits: {
          velocityDegPerS: 50.5,
          accelerationDegPerS2: 60.6,
          jerkDegPerS3: 70.7,
        },
      },
      updatedWaypoints: [{ xFt: 80.8, yFt: -90.9, thetaDeg: 100.01 }],
      timeS: 110.11,
      distanceFt: 120.12,
      zeroVelocity: true,
      driveTypeCode: 0,
      driveType: "nonholonomic",
      pathTypeCode: 1,
      pathType: "bezier",
      pickupBalls: true,
      currentLimit: 130.13,
      zeroTranslationalVelocity: false,
      correctAtBeginningOfPath: true,
    });
  });

  it("strictly reads the compatible writer output", () => {
    const project = createDemoProject();
    const encoded = buildLabviewBdx(project, project.paths[0].id);
    const decoded = parseLabviewBdx(encoded.buffer);

    expect(decoded.version).toBe("4.4");
    expect(decoded.trajectory).toHaveLength(1);
    expect(decoded.trajectory[0]).toMatchObject({
      name: "Bezier",
      typeCode: 4,
      type: "bezier",
      accelIndex: expect.any(Number),
      decelIndex: expect.any(Number),
    });
    expect(decoded.trajectory[0].positions).toHaveLength(encoded.sampleCount);
    expect(decoded.trajectory[0].velocities).toHaveLength(encoded.sampleCount);
    expect(decoded.commands).toEqual([]);
    expect(decoded.conditions.overrides).toEqual([]);
    expect(decoded.conditions.samplePeriodS).toBe(encoded.samplePeriodS);
    expect(decoded.updatedWaypoints).toHaveLength(project.paths[0].waypoints.length);
    expect(decoded.driveType).toBe("holonomic");
    expect(decoded.pathType).toBe("bezier");
  });

  it("rejects historical versions whose complete layout is not proven", () => {
    const historicalV31Header = Buffer.from([0, 0, 0, 3, 0x33, 0x2e, 0x31]);
    expect(() => parseLabviewBdx(historicalV31Header)).toThrowError(LabviewBdxUnsupportedError);
    expect(() => parseLabviewBdx(historicalV31Header)).toThrow(/only v4\.4 has a proven complete schema/);
  });

  it("bounds-checks array counts before allocating", () => {
    const project = createDemoProject();
    const corrupted = Buffer.from(buildLabviewBdx(project, project.paths[0].id).buffer);
    corrupted.writeUInt32BE(0xffffffff, 9); // Trajectory array count follows the 7-byte header and two booleans.

    expect(() => parseLabviewBdx(corrupted)).toThrowError(LabviewBdxParseError);
    expect(() => parseLabviewBdx(corrupted)).toThrow(/exceeds the supported limit/);

    const sizeConsistentExcessiveCount = Buffer.concat([
      labviewString("4.4"),
      u8(0),
      u8(0),
      u32(1025),
      Buffer.alloc(1025 * 22),
    ]);
    expect(() => parseLabviewBdx(sizeConsistentExcessiveCount)).toThrow(/supported limit of 1024/);
  });

  it("rejects non-empty commands and overrides explicitly", () => {
    const project = createDemoProject();
    const encoded = buildLabviewBdx(project, project.paths[0].id).buffer;
    const commandOffset = commandCountOffset(encoded);
    const withCommand = Buffer.from(encoded);
    withCommand.writeUInt32BE(1, commandOffset);
    expect(() => parseLabviewBdx(withCommand)).toThrowError(LabviewBdxUnsupportedError);
    expect(() => parseLabviewBdx(withCommand)).toThrow(/command records contain LabVIEW Variant and Path values/);

    const withOverride = Buffer.from(encoded);
    const overrideOffset = commandOffset + 4 + 56;
    withOverride.writeUInt32BE(1, overrideOffset);
    expect(() => parseLabviewBdx(withOverride)).toThrowError(LabviewBdxUnsupportedError);
    expect(() => parseLabviewBdx(withOverride)).toThrow(/overrides are not supported/);
  });

  it("rejects trailing and truncated data", () => {
    const project = createDemoProject();
    const encoded = buildLabviewBdx(project, project.paths[0].id).buffer;

    expect(() => parseLabviewBdx(Buffer.concat([encoded, Buffer.from([0])]))).toThrow(/trailing byte/);
    expect(() => parseLabviewBdx(encoded.subarray(0, encoded.length - 1))).toThrow(/Truncated/);
  });
});
