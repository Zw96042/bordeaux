import {
  AlertTriangle,
  Bot,
  ChevronRight,
  Download,
  FileInput,
  Gauge,
  GitBranch,
  Map,
  MousePointer2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildBdxExport, previewBdxExport } from "../shared/export/bdx";
import { PM } from "../shared/math/pm";
import { blankPath, clone, createDemoProject, FIELD_H, FIELD_W } from "../shared/project/defaults";
import type { BordeauxProject, ConstraintRange, PathDoc, ValidationIssue, Waypoint } from "../shared/types";

type Page = "plan" | "robot" | "auto";
type Selection = { kind: "wp"; index: number } | { kind: "range"; index: number } | null;

const IMG_W = 3901;
const IMG_H = 1583;
const X0 = 397;
const X1 = 3502;
const Y0 = 97;
const Y1 = 1486;
const SX = (X1 - X0) / FIELD_W;
const SY = (Y1 - Y0) / FIELD_H;

function worldToPixel(point: { x: number; y: number }) {
  return { x: X0 + point.x * SX, y: Y1 - point.y * SY };
}

function pixelToWorld(point: { x: number; y: number }) {
  return {
    x: Math.max(0, Math.min(FIELD_W, (point.x - X0) / SX)),
    y: Math.max(0, Math.min(FIELD_H, (Y1 - point.y) / SY)),
  };
}

function fieldPath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => {
      const p = worldToPixel(point);
      return `${index ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    })
    .join(" ");
}

function shortPath(path: string | null) {
  if (!path) return "Unsaved project";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1];
}

function fmt(value: number, places = 2) {
  return Number.isFinite(value) ? value.toFixed(places) : "0.00";
}

function updatePath(project: BordeauxProject, index: number, patcher: (path: PathDoc) => PathDoc): BordeauxProject {
  const paths = project.paths.slice();
  paths[index] = patcher(clone(paths[index]));
  return { ...project, paths };
}

function updateWaypoint(path: PathDoc, index: number, patch: Partial<Waypoint>): PathDoc {
  const waypoints = path.waypoints.slice();
  waypoints[index] = { ...waypoints[index], ...patch };
  return { ...path, waypoints };
}

function useMenuCommands(handlers: Record<string, (payload?: unknown) => void>) {
  useEffect(() => {
    if (!window.bordeauxAPI) return undefined;
    return window.bordeauxAPI.onMenuCommand(({ command, payload }) => handlers[command]?.(payload));
  }, [handlers]);
}

export function App() {
  const [project, setProject] = useState<BordeauxProject>(() => createDemoProject());
  const [filePath, setFilePath] = useState<string | null>(null);
  const [activePathIndex, setActivePathIndex] = useState(0);
  const [page, setPage] = useState<Page>("plan");
  const [selection, setSelection] = useState<Selection>({ kind: "wp", index: 0 });
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const path = project.paths[activePathIndex] ?? project.paths[0];
  const derived = useMemo(() => PM.derivePath(path, project.robot, 56), [path, project.robot]);
  const exportPreview = useMemo(() => previewBdxExport(project), [project]);

  const commitProject = useCallback((next: BordeauxProject) => {
    setProject(next);
    setDirty(true);
  }, []);

  const setActivePath = (index: number) => {
    setActivePathIndex(index);
    setSelection({ kind: "wp", index: 0 });
  };

  const openProjectFile = useCallback(async () => {
    if (!window.bordeauxAPI) return;
    const result = await window.bordeauxAPI.openProject();
    if (!result) return;
    setProject(result.project);
    setFilePath(result.path);
    setActivePathIndex(0);
    setSelection({ kind: "wp", index: 0 });
    setDirty(false);
    setNotice(`Opened ${shortPath(result.path)}`);
  }, []);

  const saveProjectFile = useCallback(
    async (saveAs = false) => {
      if (!window.bordeauxAPI) {
        setNotice("Desktop save is available inside Electron.");
        return;
      }
      const result = await window.bordeauxAPI.saveProject(project, saveAs ? null : filePath);
      if ("canceled" in result && result.canceled) return;
      setFilePath(result.path);
      setDirty(false);
      setNotice(`Saved ${shortPath(result.path)}`);
    },
    [filePath, project],
  );

  const newProject = useCallback(() => {
    setProject(createDemoProject());
    setFilePath(null);
    setActivePathIndex(0);
    setSelection({ kind: "wp", index: 0 });
    setDirty(false);
    setNotice("Started a fresh demo project");
  }, []);

  const exportBdx = useCallback(async () => {
    if (!exportPreview.ok) {
      setExportOpen(true);
      return;
    }
    if (!window.bordeauxAPI) {
      const exportData = buildBdxExport(project);
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name}.bdx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice("Downloaded .bdx export");
      return;
    }
    const result = await window.bordeauxAPI.exportBdx(project);
    if ("canceled" in result && result.canceled) return;
    setNotice(`Exported ${shortPath(result.path)}`);
    setExportOpen(false);
  }, [exportPreview.ok, project]);

  const menuHandlers = useMemo(
    () => ({
      "new-project": () => newProject(),
      "open-project": () => openProjectFile(),
      "save-project": () => saveProjectFile(false),
      "save-project-as": () => saveProjectFile(true),
      "export-bdx": () => setExportOpen(true),
      "open-recent": async (payload?: unknown) => {
        if (!window.bordeauxAPI || typeof payload !== "string") return;
        const result = await window.bordeauxAPI.openRecentProject(payload);
        setProject(result.project);
        setFilePath(result.path);
        setDirty(false);
        setNotice(`Opened ${shortPath(result.path)}`);
      },
    }),
    [newProject, openProjectFile, saveProjectFile],
  );
  useMenuCommands(menuHandlers);

  const updateActivePath = (patcher: (path: PathDoc) => PathDoc) => commitProject(updatePath(project, activePathIndex, patcher));

  const addPath = () => {
    const next = { ...project, paths: [...project.paths, blankPath(`Path_${project.paths.length + 1}`)] };
    commitProject(next);
    setActivePathIndex(next.paths.length - 1);
  };

  const deleteActivePath = () => {
    if (project.paths.length <= 1) return;
    const paths = project.paths.filter((_, index) => index !== activePathIndex);
    commitProject({ ...project, paths });
    setActivePathIndex(Math.max(0, activePathIndex - 1));
    setSelection({ kind: "wp", index: 0 });
  };

  const addWaypoint = () => {
    updateActivePath((current) => {
      const last = current.waypoints[current.waypoints.length - 1];
      const next = {
        ...last,
        x: Math.min(FIELD_W - 0.3, last.x + 0.8),
        y: Math.max(0.3, Math.min(FIELD_H - 0.3, last.y + 0.2)),
      };
      const waypoints = [...current.waypoints, next];
      waypoints.forEach((wp, i) => {
        const handles = PM.autoHandles(waypoints, i);
        wp.prevC = handles.prevC;
        wp.nextC = handles.nextC;
      });
      return { ...current, waypoints };
    });
    setSelection({ kind: "wp", index: path.waypoints.length });
  };

  const pointerToWorld = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = point.matrixTransform(ctm.inverse());
    return pixelToWorld(local);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag == null) return;
    const world = pointerToWorld(event);
    if (!world) return;
    updateActivePath((current) => {
      const previous = current.waypoints[drag];
      const dx = world.x - previous.x;
      const dy = world.y - previous.y;
      const nextWp = {
        ...previous,
        x: world.x,
        y: world.y,
        prevC: { x: previous.prevC.x + dx, y: previous.prevC.y + dy },
        nextC: { x: previous.nextC.x + dx, y: previous.nextC.y + dy },
      };
      return updateWaypoint(current, drag, nextWp);
    });
  };

  const selectedWp = selection?.kind === "wp" ? path.waypoints[selection.index] : null;
  const selectedRange = selection?.kind === "range" ? path.ranges[selection.index] : null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div>
            <h1>Bordeaux</h1>
            <p>{shortPath(filePath)}{dirty ? " • edited" : ""}</p>
          </div>
        </div>

        <nav className="tabs" aria-label="Workspace">
          <button className={page === "plan" ? "active" : ""} onClick={() => setPage("plan")}><Map size={16} />Plan</button>
          <button className={page === "robot" ? "active" : ""} onClick={() => setPage("robot")}><Bot size={16} />Robot</button>
          <button className={page === "auto" ? "active" : ""} onClick={() => setPage("auto")}><GitBranch size={16} />Autonomous</button>
        </nav>

        <section className="path-list">
          <div className="section-head">
            <span>Paths</span>
            <button className="icon-button" onClick={addPath} title="Add path"><Plus size={15} /></button>
          </div>
          {project.paths.map((item, index) => {
            const itemDerived = PM.derivePath(item, project.robot, 24);
            return (
              <button key={`${item.name}-${index}`} className={`path-row ${index === activePathIndex ? "active" : ""}`} onClick={() => setActivePath(index)}>
                <Waypoints size={16} />
                <span className="path-name">{item.name}</span>
                <span className="path-time">{fmt(itemDerived.prof.totalTime)}s</span>
              </button>
            );
          })}
        </section>

        <section className="export-card">
          <div className="export-top">
            <Gauge size={16} />
            <span>.bdx export</span>
          </div>
          <div className="mini-stats">
            <b>{exportPreview.pathCount}</b><span>paths</span>
            <b>{exportPreview.sampleCount}</b><span>samples</span>
          </div>
          <button className="primary" onClick={() => setExportOpen(true)}><Download size={16} />Preview export</button>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>{project.name}</h2>
            <p>{page === "plan" ? path.name : page === "robot" ? "Robot configuration" : project.routine?.name ?? "Autonomous Routine"}</p>
          </div>
          <div className="actions">
            <button onClick={openProjectFile}><FileInput size={16} />Open</button>
            <button onClick={() => saveProjectFile(false)}><Save size={16} />Save</button>
            <button className="primary" onClick={() => setExportOpen(true)}><Upload size={16} />Export .bdx</button>
          </div>
        </header>

        {page === "plan" && (
          <div className="planner-grid">
            <section className="field-panel">
              <div className="tool-rail">
                <button className="active" title="Select"><MousePointer2 size={18} /></button>
                <button title="Add waypoint" onClick={addWaypoint}><Plus size={18} /></button>
                <button title="Reset view"><RotateCcw size={18} /></button>
              </div>
              <svg
                ref={svgRef}
                className="field"
                viewBox={`0 0 ${IMG_W} ${IMG_H}`}
                onPointerMove={onPointerMove}
                onPointerUp={() => setDrag(null)}
                onPointerCancel={() => setDrag(null)}
              >
                <image href="/field.png" x="0" y="0" width={IMG_W} height={IMG_H} preserveAspectRatio="xMidYMid meet" />
                <path className="path-shadow" d={fieldPath(derived.sample.pts)} />
                <path className="path-line" d={fieldPath(derived.sample.pts)} />
                {path.ranges.map((range, index) => {
                  const start = PM.pointAtFraction(Math.min(range.f0, range.f1), derived.sample.pts);
                  const end = PM.pointAtFraction(Math.max(range.f0, range.f1), derived.sample.pts);
                  return <path key={index} className="range-line" d={fieldPath([start, end])} onClick={() => setSelection({ kind: "range", index })} />;
                })}
                {path.markers.map((marker) => {
                  const p = worldToPixel(PM.pointAtFraction(marker.f, derived.sample.pts));
                  return <g key={marker.name} className="marker" transform={`translate(${p.x} ${p.y})`}><path d="M0,-20 L13,9 L0,4 L-13,9 Z" /><text y="-26">{marker.name}</text></g>;
                })}
                {path.waypoints.map((wp, index) => {
                  const p = worldToPixel(wp);
                  return (
                    <g key={index} className={`waypoint ${selection?.kind === "wp" && selection.index === index ? "selected" : ""}`} transform={`translate(${p.x} ${p.y})`}>
                      <circle
                        r="24"
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setDrag(index);
                          setSelection({ kind: "wp", index });
                        }}
                      />
                      <text y="-34">{index === 0 ? "START" : index === path.waypoints.length - 1 ? "END" : `WP ${index}`}</text>
                    </g>
                  );
                })}
              </svg>
            </section>

            <aside className="inspector">
              <div className="inspector-head">
                <span>{selection?.kind === "range" ? "Constraint Range" : "Waypoint"}</span>
                <button className="danger" onClick={deleteActivePath}><Trash2 size={15} />Delete path</button>
              </div>
              <PathInspector
                path={path}
                selectedWp={selectedWp}
                selectedRange={selectedRange}
                selection={selection}
                metrics={derived}
                onPatchPath={(patch) => updateActivePath((current) => ({ ...current, ...patch }))}
                onPatchWaypoint={(index, patch) => updateActivePath((current) => updateWaypoint(current, index, patch))}
                onPatchRange={(index, patch) =>
                  updateActivePath((current) => {
                    const ranges = current.ranges.slice();
                    ranges[index] = { ...ranges[index], ...patch };
                    return { ...current, ranges };
                  })
                }
              />
            </aside>
          </div>
        )}

        {page === "robot" && (
          <RobotPage project={project} onChange={(robot) => commitProject({ ...project, robot })} />
        )}

        {page === "auto" && <AutonomousPage project={project} />}
      </section>

      {notice && <button className="toast" onClick={() => setNotice(null)}>{notice}</button>}

      {exportOpen && (
        <ExportDialog
          preview={exportPreview}
          issues={exportPreview.issues}
          onClose={() => setExportOpen(false)}
          onExport={exportBdx}
        />
      )}
    </main>
  );
}

function NumField(props: { label: string; value: number; step?: number; min?: number; max?: number; unit?: string; onChange(value: number): void }) {
  return (
    <label className="field-control">
      <span>{props.label}</span>
      <div className="number-wrap">
        <input
          type="number"
          value={Number.isFinite(props.value) ? props.value : 0}
          step={props.step ?? 0.1}
          min={props.min}
          max={props.max}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
        {props.unit && <em>{props.unit}</em>}
      </div>
    </label>
  );
}

function PathInspector(props: {
  path: PathDoc;
  selectedWp: Waypoint | null;
  selectedRange: ConstraintRange | null;
  selection: Selection;
  metrics: any;
  onPatchPath(patch: Partial<PathDoc>): void;
  onPatchWaypoint(index: number, patch: Partial<Waypoint>): void;
  onPatchRange(index: number, patch: Partial<ConstraintRange>): void;
}) {
  const { path, selectedWp, selectedRange, selection, metrics } = props;
  return (
    <div className="inspector-body">
      <label className="field-control wide">
        <span>Path name</span>
        <input value={path.name} onChange={(event) => props.onPatchPath({ name: event.target.value })} />
      </label>
      <div className="stat-strip">
        <span><b>{fmt(metrics.prof.totalTime)}</b>s</span>
        <span><b>{fmt(metrics.sample.length)}</b>m</span>
        <span><b>{fmt(metrics.metrics.vMax)}</b>m/s</span>
      </div>

      {selectedWp && selection?.kind === "wp" && (
        <>
          <div className="section-label">Waypoint {selection.index}</div>
          <div className="two-col">
            <NumField label="X" value={selectedWp.x} unit="m" step={0.05} onChange={(x) => props.onPatchWaypoint(selection.index, { x })} />
            <NumField label="Y" value={selectedWp.y} unit="m" step={0.05} onChange={(y) => props.onPatchWaypoint(selection.index, { y })} />
          </div>
          <NumField label="Heading" value={selectedWp.theta} unit="deg" step={1} onChange={(theta) => props.onPatchWaypoint(selection.index, { theta, thetaOn: true })} />
          <label className="toggle-row">
            <input type="checkbox" checked={selectedWp.stop} onChange={(event) => props.onPatchWaypoint(selection.index, { stop: event.target.checked })} />
            Stop at waypoint
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={selectedWp.thetaOn} onChange={(event) => props.onPatchWaypoint(selection.index, { thetaOn: event.target.checked })} />
            Pin heading
          </label>
        </>
      )}

      {selectedRange && selection?.kind === "range" && (
        <>
