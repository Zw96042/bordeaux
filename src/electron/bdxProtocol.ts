import type { BordeauxProject } from "../shared/types";
import type { BinaryBindings, BinarySelection } from "../shared/export/robotBinary";
export interface BdxJob { project: BordeauxProject; selection: BinarySelection; bindings: BinaryBindings }
export interface BdxBatchJob { project: BordeauxProject; selections: BinarySelection[]; bindings: BinaryBindings }
