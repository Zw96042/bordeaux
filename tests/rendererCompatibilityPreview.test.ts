import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PM } from "../src/shared/math/pm";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { loadRendererExport } from "./helpers/loadRendererExport";

interface Point { x: number; y: number }

function rendererMath() {
  return loadRendererExport<{
    derivePath(path: unknown, robot: unknown, perSegment: number, plannerId: string): {
      sample: { pts: Array<Point & { s: number }>; length: number };
      prof: { totalTime: number };
    };
  }>(new URL("../src/renderer/lib/pathMath.js", import.meta.url), "PM", { context: { console } });
}

function rendererPathLinks() {
  return loadRendererExport<{
    reconcile(project: any): any;
    sync(project: any, changedId: string, before: any): any;
  }>(new URL("../src/renderer/lib/pathLinks.js", import.meta.url), "PathLinks");
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

  it.each([2, 56])("keeps shared and renderer clothoid endpoints exact at density %s", (samplesPerSegment) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, segType: "clothoid" },
      { x: 5, y: 5, segType: "clothoid" },
      { x: 10, y: 2, segType: "clothoid" },
      { x: 12, y: 6, segType: "line" },
    ]);
    const shared = PM.sample(path.waypoints, samplesPerSegment).pts;
    const renderer = rendererMath().derivePath(path, project.robot, samplesPerSegment, "profiledSpline").sample.pts;

    path.waypoints.forEach((waypoint, index) => {
      expect(shared[index * samplesPerSegment]).toMatchObject({ x: waypoint.x, y: waypoint.y });
      expect(renderer[index * samplesPerSegment]).toMatchObject({ x: waypoint.x, y: waypoint.y });
    });
  });

  it("loads React through the typed renderer module entry without compatibility globals", () => {
    const html = fs.readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
    const main = fs.readFileSync(new URL("../src/renderer/main.tsx", import.meta.url), "utf8");
    expect(html).toContain('<script type="module" src="/main.tsx"></script>');
    expect(html).not.toContain("react.production.min.js");
    expect(main).toContain('from "react"');
    expect(main).toContain('from "react-dom/client"');
    expect(main).toContain('from "./app/App"');
    expect(main).not.toContain("window.React");
    expect(fs.existsSync(new URL("../src/renderer/legacy", import.meta.url))).toBe(false);
  });

  it("presents only maintained planners and Java export", () => {
    const panels = fs.readFileSync(new URL("../src/renderer/components/Panels.jsx", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(panels).toContain("{ v: 'profiledSpline', label: 'Profiled' }");
    expect(panels).toContain("{ v: 'optimizedTrajectory', label: 'Optimized' }");
    expect(app).toContain("exportJava");
    expect(panels).not.toMatch(/LabVIEW|labview|\.bdx/);
    expect(app).toContain("normalizeProjectData(raw)");
  });

  it("uses canonical shared project state without local compatibility mirrors", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain('normalizeProject as normalizeProjectData');
    expect(app).not.toMatch(/project\.routine(?!s)/);
    expect(app).not.toMatch(/\.\.\.project,\s*routine[,}]/);
    expect(app).toContain("const plannerId = project.plannerId");
    expect(app).not.toContain("setPlannerId");
  });

  it("persists and restores the selected path and Java project bookmark", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain("javaProjectBookmarkId: result.bookmarkId");
    expect(app).toContain("activePathId }" );
    expect(app).toContain("const requestedPathId = next.editor && next.editor.activePathId");
    expect(app).toContain("openRecentJavaProject(next.editor.javaProjectBookmarkId, javaGeneration)");
    expect(app).toContain("javaRestoreGeneration.current !== generation");
    expect(app).toContain("window.bordeauxAPI.autosaveProject");
  });

  it("keeps linked path endpoints synchronized in both directions", () => {
    const links = rendererPathLinks();
    const project = createDemoProject();
    const source = structuredClone(project.paths[0]);
    const target = structuredClone(source);
    source.id = "path_source";
    target.id = "path_target";
    target.waypoints[0].x = 8;
    target.waypoints[0].prevC.x += 3;
    target.waypoints[0].nextC.x += 3;
    const linked = { ...project, paths: [source, target], pathLinks: [{ id: "link_1", fromPathId: source.id, toPathId: target.id }] };

    const reconciled = links.reconcile(linked);
    expect(reconciled.paths[1].waypoints[0]).toMatchObject({
      x: source.waypoints.at(-1)!.x,
      y: source.waypoints.at(-1)!.y,
      theta: source.waypoints.at(-1)!.theta,
      thetaOn: source.waypoints.at(-1)!.thetaOn,
    });
    expect(reconciled.paths[1].waypoints[0].stop).toBe(target.waypoints[0].stop);

    const beforeSource = structuredClone(reconciled.paths[0]);
    const movedSource = structuredClone(beforeSource);
    movedSource.waypoints.at(-1)!.x += 1;
    const forward = links.sync({ ...reconciled, paths: [movedSource, reconciled.paths[1]] }, movedSource.id, beforeSource);
    expect(forward.paths[1].waypoints[0].x).toBe(movedSource.waypoints.at(-1)!.x);

    const beforeTarget = structuredClone(forward.paths[1]);
    const movedTarget = structuredClone(beforeTarget);
    movedTarget.waypoints[0].y += 1;
    const reverse = links.sync({ ...forward, paths: [forward.paths[0], movedTarget] }, movedTarget.id, beforeTarget);
    expect(reverse.paths[0].waypoints.at(-1)!.y).toBe(movedTarget.waypoints[0].y);
  });

  it("contains planner failures", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain("derivation.error && h('div'");
    expect(app).toContain("class AppErrorBoundary");
  });

  it("wires field gestures through the shared coalesced drag controller", () => {
    const field = fs.readFileSync(new URL("../src/renderer/components/FieldView.jsx", import.meta.url), "utf8");
    expect(field).toContain("PointerDrag.useController");
    expect(field).toContain("coalesce: true");
  });

  it("keeps animation-frame playback below the root editor render", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain("function createPlaybackStore()");
    expect(app).toContain("useSyncExternalStore");
    expect(app).not.toContain("const [playTime, setPlayTime]");
    expect(app).not.toContain("const [routineTime, setRoutineTime]");
  });

  it("offers clustered tool aliases and preserves the established shortcuts", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    const panels = fs.readFileSync(new URL("../src/renderer/components/Panels.jsx", import.meta.url), "utf8");
    expect(app).toContain("'1': 'select', '2': 'waypoint', '3': 'rotation', '4': 'marker', '5': 'range'");
    expect(app).toContain("v: 'select', w: 'waypoint', r: 'rotation', m: 'marker', c: 'range'");
    expect(panels).toContain("alternateKey: 'V'");
    expect(panels).toContain("alternateKey: 'C'");
  });

  it("keeps the path fixed when flipping the field background", () => {
    const field = fs.readFileSync(new URL("../src/renderer/components/FieldView.jsx", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(field).toContain("transform: flip ? `rotate(180 ${FIELD_CX} ${FIELD_CY})` : undefined");
    expect(field).toContain("const W2P = useCallback((p) => ({ x: wx(p.x), y: wy(p.y) }), []);");
    expect(field).not.toContain("FIELD_W - p.x");
    expect(field).not.toContain("FIELD_H - p.y");
    expect(field.match(/\bflip\b/g)).toHaveLength(2);
    expect(app).not.toContain("const flip = alliance === 'red' ? -1 : 1");
    expect(app).toContain("allianceView: 'blue'");
    expect(app).not.toContain("allianceView: alliance");
  });

  it("keeps dormant Chap assets out of the application shell", () => {
    const html = fs.readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
    const panels = fs.readFileSync(new URL("../src/renderer/components/Panels.jsx", import.meta.url), "utf8");
    expect(html).not.toContain("wrlp-chap-bird-original.svg");
    expect(html).not.toContain("boot-splash");
    expect(panels).not.toContain("brand-mark");
    expect(panels).toContain("'Bordeaux'");
  });
});
