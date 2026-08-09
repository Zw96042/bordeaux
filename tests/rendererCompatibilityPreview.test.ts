import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createDemoProject } from "../src/shared/project/defaults";

interface Point { x: number; y: number }

function rendererMath() {
  const window: Record<string, unknown> = {};
  const source = fs.readFileSync(new URL("../public/renderer/assets/path-math.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, console, Math, Number, Set, Map, Infinity, isFinite });
  return window.PM as {
    derivePath(path: unknown, robot: unknown, perSegment: number, plannerId: string): {
      sample: { pts: Array<Point & { s: number }>; length: number };
      prof: { totalTime: number };
    };
  };
}

describe("renderer application", () => {
  it("derives finite previews with each maintained planner", () => {
    const project = createDemoProject();
    for (const planner of ["profiledSpline", "optimizedTrajectory"]) {
      const preview = rendererMath().derivePath(project.paths[0], project.robot, 56, planner);
      expect(preview.sample.pts.length).toBeGreaterThan(2);
      expect(preview.sample.pts.every((point) => Number.isFinite(point.x + point.y + point.s))).toBe(true);
      expect(preview.sample.length).toBeGreaterThan(0);
      expect(preview.prof.totalTime).toBeGreaterThan(0);
    }
  });

  it("ships production React without development payloads", () => {
    const html = fs.readFileSync(new URL("../public/renderer/index.html", import.meta.url), "utf8");
    expect(html).toContain('src="assets/react.production.min.js"');
    expect(html).toContain('src="assets/react-dom.production.min.js"');
    expect(html).not.toContain("react.development.js");
    expect(html).not.toContain("react-dom.development.js");
  });

  it("presents only maintained planners and Java export", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    expect(panels).toContain("{ v: 'profiledSpline', label: 'Profiled' }");
    expect(panels).toContain("{ v: 'optimizedTrajectory', label: 'Optimized' }");
    expect(app).toContain("exportJava");
    expect(panels).not.toMatch(/LabVIEW|labview|\.bdx/);
    expect(app.match(/delete p\.labview/g)).toHaveLength(1);
  });

  it("persists and restores the selected path and Java project bookmark", () => {
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    expect(app).toContain("javaProjectBookmarkId: result.bookmarkId");
    expect(app).toContain("activePathId }" );
    expect(app).toContain("const requestedPathId = next.editor && next.editor.activePathId");
    expect(app).toContain("openRecentJavaProject(next.editor.javaProjectBookmarkId, javaGeneration)");
    expect(app).toContain("javaRestoreGeneration.current !== generation");
    expect(app).toContain("window.bordeauxAPI.autosaveProject");
  });

  it("contains planner failures and retains the last valid preview", () => {
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    expect(app).toContain("const lastDerived = useRef(null)");
    expect(app).toContain("derivation.error && h('div'");
    expect(app).toContain("class AppErrorBoundary");
  });

  it("coalesces pointer motion and cleans up global drag listeners", () => {
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");
    expect(field).toContain("requestAnimationFrame");
    expect(field).toContain("cancelAnimationFrame");
    expect(field).toContain("onPointerCancel: onCancel");
    expect(field).toContain("onLostPointerCapture: onCancel");
    expect(field).toContain("removeEventListener('blur', onCancel)");
  });

  it("keeps dormant Chap assets out of the application shell", () => {
    const html = fs.readFileSync(new URL("../public/renderer/index.html", import.meta.url), "utf8");
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    expect(html).not.toContain("wrlp-chap-bird-original.svg");
    expect(html).not.toContain("boot-splash");
    expect(panels).not.toContain("brand-mark");
    expect(panels).toContain("'Bordeaux'");
  });
});
