import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Local .scratch/, work/, and example trees carry their own archived tests.
    include: ["tests/**/*.test.?(c|m)[jt]s?(x)"],
  },
});
