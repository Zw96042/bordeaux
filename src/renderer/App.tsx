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

