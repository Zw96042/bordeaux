import { describe, expect, it } from "vitest";
import { rangeLabelIndexes } from "../src/renderer/components/FieldView";

describe("renderer range labels", () => {
  it("caps dense label layout while preserving the selected range", () => {
    const indexes = rangeLabelIndexes(160, 159);

    expect(indexes.size).toBe(80);
    expect(indexes.has(159)).toBe(true);
  });
});
