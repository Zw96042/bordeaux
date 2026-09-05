import { describe, expect, it } from "vitest";
import { planningErrorMessage, shouldPresentPlanningError } from "../src/renderer/lib/planningFeedback";

describe("planning feedback presentation", () => {
  it("keeps an initial fallback quiet until the user changes planning input", () => {
    const error = new Error("Final optimization did not preserve the renderer geometry");

    expect(shouldPresentPlanningError(error, "final", 0)).toBe(false);
    expect(shouldPresentPlanningError(error, "final", 1)).toBe(true);
    expect(shouldPresentPlanningError(null, "final", 1)).toBe(false);
  });

  it("always presents an interactive planning failure", () => {
    const error = new Error("The edited path could not be derived");

    expect(shouldPresentPlanningError(error, "interactive", 0)).toBe(true);
  });

  it("removes fallback boilerplate from a final-planning notice", () => {
    const error = new Error("Final planning failed: Heading tracking could not satisfy the configured angular limits. Continuing with the last interactive result.");

    expect(planningErrorMessage(error, "final")).toBe("Heading tracking could not satisfy the configured angular limits");
    expect(planningErrorMessage(error, "interactive")).toBe(error.message);
  });
});
