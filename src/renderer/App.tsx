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
