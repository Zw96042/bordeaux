import { randomUUID } from "node:crypto";
import { analyzePath } from "../shared/agent/pathAnalysis";
import { robotFootprintVertices } from "../shared/agent/robotFootprint";
import { generateRepairCandidates } from "../shared/agent/pathRepair";
import { generateRouteCandidates } from "../shared/agent/routeCandidates";
import type { AgentProposal, AgentSessionSnapshot, PathProposal, PlanPathRequest, RobotProfileProposal } from "../shared/agent/types";
import { REBUILT_2026_FIELD } from "../shared/field/rebuilt2026";
import { resolveProjectFieldTerm, withAllianceView } from "../shared/field/vocabulary";
import type { RobotRelativePose } from "../shared/field/types";
import { clone } from "../shared/project/defaults";
import type { JavaCommandCatalog, RobotPlanningProfile } from "../shared/types";
import { defaultJavaCommandArguments, javaInvocationErrors } from "../shared/javaCommands";
import { validateProject } from "../shared/validation";

const MAX_PROPOSALS = 24;
const PROPOSAL_TTL_MS = 30 * 60 * 1_000;

export type AgentRequest =
  | { method: "inspect_session" }
  | { method: "field_pack" }
  | { method: "commands" }
  | { method: "inspect_robot_profile" }
  | { method: "propose_robot_profile"; params: { intent: string; planning: RobotPlanningProfile } }
  | { method: "resolve_field_terms"; params: { phrases: string[]; alliance?: "blue" | "red"; pose?: RobotRelativePose; relativeDistanceM?: number; robotHeightM?: number } }
  | { method: "analyze_path"; params: { pathId?: string; sampleLimit?: number; minimumClearanceM?: number } }
  | { method: "repair_path"; params: { pathId?: string; findingIds: string[]; minimumClearanceM?: number } }
  | { method: "plan_path"; params: PlanPathRequest }
  | { method: "get_proposal"; params: { proposalId: string } };

function requireSnapshot(snapshot: AgentSessionSnapshot | null): AgentSessionSnapshot {
  if (!snapshot) throw new Error("Open a Bordeaux project and wait for the editor to finish loading, then retry.");
  return snapshot;
}

function publicSession(snapshot: AgentSessionSnapshot, catalog: JavaCommandCatalog | null) {
  return {
    sessionId: snapshot.sessionId,
    revision: snapshot.revision,
    projectName: snapshot.project.name,
    activePathId: snapshot.activePathId,
    paths: snapshot.project.paths.map((path) => ({ id: path.id, name: path.name, waypointCount: path.waypoints.length })),
    robot: snapshot.project.robot,
    robotCollisionModel: {
      localFrame: "+X forward, +Y left, meters from the robot reference point",
      shape: snapshot.project.robot.footprint?.kind ?? "rectangle",
      verticesM: robotFootprintVertices(snapshot.project.robot),
      heightM: snapshot.project.robot.heightM ?? null,
      heightKnown: snapshot.project.robot.heightM !== undefined,
    },
    plannerId: snapshot.plannerId,
    allianceView: snapshot.allianceView,
    coordinateContext: {
      authoredFrame: "Bordeaux overhead-image coordinates: red is low-X/left, blue is high-X/right, +Y is screen-up.",
      displayFrame: snapshot.allianceView === "red" ? "Red view rotates authored points 180 degrees for display only." : "Blue view displays authored points without rotation.",
      ownershipRule: "An explicit red/blue term selects that physical field structure; allianceView never changes ownership.",
    },
    fieldPack: snapshot.fieldPack,
    javaCatalog: catalog ? { catalogId: catalog.catalogId, catalogHash: catalog.catalogHash, commandCount: catalog.commands.length, authoritative: catalog.authoritative === true } : null,
    strategy: snapshot.project.strategy ?? null,
  };
}

function routeRecommendationReason(candidates: ReturnType<typeof generateRouteCandidates>, recommendedCandidateId: string): string {
  const winner = candidates.find((candidate) => candidate.id === recommendedCandidateId)!;
  const valid = candidates.filter((candidate) => candidate.valid);
  if (!winner.valid) return `No generated candidate passed validation; ${winner.label} is shown only for diagnosis.`;
  const fastest = valid.reduce((best, candidate) => candidate.metrics.totalTimeS < best.metrics.totalTimeS ? candidate : best, valid[0]);
  if (fastest.id === winner.id) return `${winner.label} is the fastest of ${valid.length} valid generated candidates at ${winner.metrics.totalTimeS.toFixed(2)} s.`;
  const margin = (winner.metrics.totalTimeS - fastest.metrics.totalTimeS).toFixed(2);
  if (winner.metrics.minimumClearanceM > fastest.metrics.minimumClearanceM + 1e-6) return `${winner.label} is within ${margin} s of the fastest generated candidate and has greater modeled clearance (${winner.metrics.minimumClearanceM.toFixed(2)} m).`;
  if (winner.metrics.peakCurvatureInvM < fastest.metrics.peakCurvatureInvM - 1e-6) return `${winner.label} is within ${margin} s of the fastest generated candidate and has lower peak curvature (${winner.metrics.peakCurvatureInvM.toFixed(3)} 1/m).`;
  if (winner.metrics.peakAngularVelocityRadps < fastest.metrics.peakAngularVelocityRadps - 1e-6) return `${winner.label} is within ${margin} s of the fastest generated candidate and has lower peak angular velocity (${winner.metrics.peakAngularVelocityRadps.toFixed(3)} rad/s).`;
  if (winner.metrics.waypointCount < fastest.metrics.waypointCount) return `${winner.label} is within ${margin} s of the fastest generated candidate and uses fewer waypoints (${winner.metrics.waypointCount}).`;
  return `${winner.label} is within ${margin} s of the fastest generated candidate and won the deterministic candidate-ID tie-break after all safety metrics tied.`;
}

export class AgentSessionService {
  private snapshot: AgentSessionSnapshot | null = null;
  private readonly proposals = new Map<string, AgentProposal>();

  constructor(
    private readonly sendProposal: (proposal: AgentProposal, requireReceipt: boolean) => void | Promise<void>,
    private readonly getJavaCatalog: () => JavaCommandCatalog | null,
  ) {}

  clearSnapshot(): void {
    this.snapshot = null;
    for (const proposal of this.proposals.values()) {
      if (proposal.status === "ready") proposal.status = "stale";
    }
