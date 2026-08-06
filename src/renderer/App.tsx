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
