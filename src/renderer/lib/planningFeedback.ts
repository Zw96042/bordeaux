export type PlanningErrorKind = "interactive" | "final" | null;

export const FINAL_PLANNING_NOTICE_DELAY_MS = 700;
export const FINAL_PLANNING_NOTICE_DURATION_MS = 4_500;
export const FINAL_PLANNING_NOTICE_COOLDOWN_MS = 30_000;

export function shouldPresentPlanningError(
  error: unknown,
  kind: PlanningErrorKind,
  planningInputRevision: number,
): boolean {
  if (!error) return false;
  return kind !== "final" || planningInputRevision > 0;
}

export function planningErrorMessage(error: unknown, kind: PlanningErrorKind): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (kind !== "final") return raw;
  return raw
    .replace(/^Final planning failed:\s*/i, "")
    .replace(/[.;]?\s*Continuing with the last interactive result\.?$/i, "")
    .trim();
}
