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

