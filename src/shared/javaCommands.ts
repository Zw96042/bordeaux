import type {
  BordeauxProject,
  CommandArgumentValue,
  CommandInvocation,
  JavaCommandCatalog,
  JavaCommandDescriptor,
  JavaCommandParameter,
  JavaValueSchema,
  ValidationIssue,
} from "./types";

const MAX_SCHEMA_DEPTH = 24;
const MAX_ARRAY_ITEMS = 1_024;
const MAX_MAP_ENTRIES = 256;

function simpleJavaType(javaType: string): string {
  return javaType.split(".").at(-1) ?? javaType;
}

function integerRange(javaType: string): readonly [number, number] | null {
  const simple = simpleJavaType(javaType);
  if (simple === "byte" || simple === "Byte") return [-128, 127];
  if (simple === "short" || simple === "Short") return [-32768, 32767];
  if (simple === "int" || simple === "Integer") return [-2147483648, 2147483647];
  return null;
}

function exactIntegerError(value: unknown, javaType: string): string | null {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value)) return "must be a whole number written as digits";
  if (value.length > 1_024) return "cannot exceed 1024 characters";
  const simple = simpleJavaType(javaType);
  if (simple === "long" || simple === "Long") {
    const parsed = BigInt(value);
    if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) return "must fit the signed 64-bit long range";
  }
  return null;
}

function exactDecimalError(value: unknown): string | null {
  if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return "must be a decimal number written as text";
  }
  if (value.length > 1_024) return "cannot exceed 1024 characters";
  const exponent = /[eE]([+-]?\d+)$/.exec(value);
  if (exponent && Math.abs(Number(exponent[1])) > 10_000) return "exponent cannot exceed 10000 in magnitude";
  return null;
}

export function compareExactDecimals(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
    if (!match) throw new Error("Invalid exact decimal");
    const fraction = match[3] ?? match[4] ?? "";
    const rawDigits = `${match[2] ?? "0"}${fraction}`.replace(/^0+/, "") || "0";
    const exponent = Number(match[5] ?? 0) - fraction.length;
    return { sign: rawDigits === "0" ? 0 : match[1] === "-" ? -1 : 1, digits: rawDigits, exponent };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  const aPower = a.digits.length + a.exponent;
  const bPower = b.digits.length + b.exponent;
  let magnitude = aPower === bPower ? 0 : aPower < bPower ? -1 : 1;
  if (magnitude === 0) {
    const length = Math.max(a.digits.length, b.digits.length);
    for (let index = 0; index < length; index += 1) {
      const aDigit = a.digits[index] ?? "0";
      const bDigit = b.digits[index] ?? "0";
      if (aDigit !== bDigit) {
        magnitude = aDigit < bDigit ? -1 : 1;
        break;
      }
    }
  }
  return a.sign < 0 ? -magnitude : magnitude;
}

export function javaSchemaValueError(value: unknown, schema: JavaValueSchema, valuePath = "Value", depth = 0): string | null {
  if (depth > MAX_SCHEMA_DEPTH) return `${valuePath} exceeds the supported nesting depth`;
  if (value === undefined) return `${valuePath} is required`;
  if (schema.kind === "opaque") return isJsonValue(value, depth) ? null : `${valuePath} must be JSON-compatible`;
  if (schema.kind === "optional") return value === null ? null : javaSchemaValueError(value, schema.element!, valuePath, depth + 1);
  if (schema.kind === "boolean") return typeof value === "boolean" ? null : `${valuePath} must be true or false`;
  if (schema.kind === "integer") {
    if (!Number.isSafeInteger(value)) return `${valuePath} must be a safe whole number`;
    const range = integerRange(schema.javaType);
    return !range || ((value as number) >= range[0] && (value as number) <= range[1]) ? null : `${valuePath} is outside the range for ${schema.javaType}`;
  }
  if (schema.kind === "integerString") {
