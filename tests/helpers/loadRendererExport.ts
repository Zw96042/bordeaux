import fs from "node:fs";
import vm from "node:vm";
import {
  effectivePathConstraints,
  motorAccelerationAtSpeed,
  motorLimitedVelocityAfterDistance,
  robotHardLimits,
} from "../../src/shared/robotLimits";
import { indexIntervalPolicies } from "../../src/shared/planners/intervalPolicies";

interface LoadOptions {
  context?: Record<string, unknown>;
  replacements?: ReadonlyArray<readonly [string, string]>;
  window?: Record<string, unknown>;
}

/** Loads one legacy-style renderer export without duplicating VM setup in tests. */
export function loadRendererExport<T>(url: URL, name: string, options: LoadOptions = {}): T {
  const rendererWindow = options.window ?? {};
  let source = fs.readFileSync(url, "utf8").replace(/^import .*;\r?\n/gm, "");
  for (const [from, to] of options.replacements ?? []) source = source.replace(from, to);
  source = source.replace(`export const ${name} =`, `window.${name} =`);
  vm.runInNewContext(source, {
    effectiveConstraints: effectivePathConstraints,
    indexIntervalPolicies,
    motorAccelerationAtSpeed,
    motorLimitedVelocityAfterDistance,
    robotHardLimits,
    ...options.context,
    window: rendererWindow,
  });
  return rendererWindow[name] as T;
}
