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
  }

  publishSnapshot(value: AgentSessionSnapshot): void {
    if (!value || typeof value.sessionId !== "string" || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("Agent session snapshot is invalid");
    const validation = validateProject(value.project);
    if (!validation.ok) throw new Error("Agent session project snapshot is invalid");
    if (!value.project.paths.some((path) => path.id === value.activePathId)) throw new Error("Agent session active path does not exist");
    const previous = this.snapshot;
    this.snapshot = value;
    if (!previous || previous.sessionId !== value.sessionId || previous.revision !== value.revision) {
      for (const proposal of this.proposals.values()) {
        if (proposal.status === "ready" && (proposal.baseSessionId !== value.sessionId || proposal.baseRevision !== value.revision)) {
          proposal.status = "stale";
          void Promise.resolve(this.sendProposal(proposal, false)).catch(() => undefined);
        }
      }
    }
    this.expireProposals();
  }

  tryPublishSnapshot(value: AgentSessionSnapshot): boolean {
    try {
      this.publishSnapshot(value);
      return true;
    } catch {
      return false;
    }
  }

  updateProposalStatus(proposalId: string, status: "applied" | "rejected" | "stale", appliedRevision?: number): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return;
    proposal.status = status;
    if (status === "applied" && Number.isSafeInteger(appliedRevision)) proposal.appliedRevision = appliedRevision;
  }

  getActiveProposal(): AgentProposal | null {
    this.expireProposals();
    const proposals = [...this.proposals.values()];
    for (let index = proposals.length - 1; index >= 0; index -= 1) {
      const proposal = proposals[index];
      if (proposal.status === "ready" && this.snapshot && proposal.baseSessionId === this.snapshot.sessionId && proposal.baseRevision === this.snapshot.revision) return proposal;
    }
    return null;
  }

  private expireProposals(): void {
    const cutoff = Date.now() - PROPOSAL_TTL_MS;
    for (const proposal of this.proposals.values()) {
      if (proposal.status === "ready" && Date.parse(proposal.createdAt) < cutoff) proposal.status = "expired";
    }
    while (this.proposals.size > MAX_PROPOSALS) this.proposals.delete(this.proposals.keys().next().value!);
  }

  private async stage<T extends AgentProposal>(proposal: T): Promise<T> {
    if (!this.snapshot || this.snapshot.sessionId !== proposal.baseSessionId || this.snapshot.revision !== proposal.baseRevision) {
      throw new Error("The Bordeaux editor session changed while the proposal was being generated. Retry against the current session.");
    }
    for (const existing of this.proposals.values()) {
      if (existing.status !== "ready") continue;
      existing.status = "stale";
      void Promise.resolve(this.sendProposal(existing, false)).catch(() => undefined);
    }
    this.proposals.set(proposal.id, proposal);
    this.expireProposals();
    try { await this.sendProposal(proposal, true); }
    catch (error) { this.proposals.delete(proposal.id); throw error; }
    if (!this.snapshot || this.snapshot.sessionId !== proposal.baseSessionId || this.snapshot.revision !== proposal.baseRevision || proposal.status !== "ready") {
      throw new Error("The Bordeaux editor session changed before it acknowledged the proposal. Retry against the current session.");
    }
    return proposal;
  }

  async request(request: AgentRequest): Promise<unknown> {
    this.expireProposals();
    if (request.method === "field_pack") return REBUILT_2026_FIELD;
    if (request.method === "get_proposal") {
      const proposal = this.proposals.get(request.params.proposalId);
      if (!proposal) throw new Error("That proposal does not exist or has expired.");
      return proposal;
    }
    const snapshot = requireSnapshot(this.snapshot);
    if (request.method === "inspect_session") return publicSession(snapshot, this.getJavaCatalog());
    if (request.method === "commands") return this.getJavaCatalog() ?? { authoritative: false, commands: [], warnings: ["Link and build a generated Java command catalog to expose team actions."] };
    if (request.method === "inspect_robot_profile") {
      const planning = snapshot.project.robot.planning;
      const missing = [
        ...(!planning?.intake ? ["intake"] : []),
        ...(!planning?.shooter ? ["shooter"] : []),
      ];
      return {
        planning: planning ?? null,
        completeForFuelCollection: Boolean(planning?.intake),
        missing,
        questions: [
          ...(!planning?.intake ? [
            "Where is the primary intake in the robot-local frame (+X forward, +Y left), which direction does it collect, how wide is its effective opening, and what is the maximum safe collection speed?",
          ] : []),
          ...(!planning?.shooter ? [
            "Which robot-relative direction does the shooter fire, must that direction face the target, and is there a preferred shooting range?",
          ] : []),
          "Are there any strategy constraints or mechanism details the path planner must always honor?",
        ],
        coordinateFrame: "+X forward, +Y left, positions in meters, directions in degrees counterclockwise from +X.",
      };
    }
    if (request.method === "propose_robot_profile") {
      if (!request.params.intent.trim()) throw new Error("A robot-profile intent is required.");
      const planning: RobotPlanningProfile = {
        ...(snapshot.project.robot.planning ?? {}),
        ...clone(request.params.planning),
      };
      const candidateProject = clone(snapshot.project);
      candidateProject.robot.planning = planning;
      const validation = validateProject(candidateProject);
      const planningIssues = validation.issues.filter((item) => item.path.startsWith("$.robot.planning"));
      if (planningIssues.length) throw new Error(planningIssues.map((item) => `${item.path}: ${item.message}`).join("; "));
      const summary = [
        planning.intake
          ? `${planning.intake.name}: ${planning.intake.captureWidthM.toFixed(2)} m capture width, ${planning.intake.maxCollectSpeedMps.toFixed(2)} m/s collection limit, ${planning.intake.directionDeg.toFixed(0)}° from robot forward.`
          : "No intake is configured; FUEL-collection heading cannot be certified.",
        planning.shooter
          ? `Shooter direction ${planning.shooter.directionDeg.toFixed(0)}°${planning.shooter.requiresTargetFacing ? " must face its target" : " does not require target-facing heading"}.`
          : "No shooter geometry is configured.",
        ...(planning.notes?.trim() ? [planning.notes.trim()] : []),
      ];
      const proposal: RobotProfileProposal = {
        id: `proposal_${randomUUID()}`,
        baseSessionId: snapshot.sessionId,
        baseRevision: snapshot.revision,
        intent: request.params.intent,
        operation: "configureRobot",
        planning: clone(planning),
        summary,
        status: "ready",
        createdAt: new Date().toISOString(),
      };
      return this.stage(proposal);
    }
    if (request.method === "resolve_field_terms") {
      if (!Array.isArray(request.params.phrases) || request.params.phrases.length < 1 || request.params.phrases.length > 24) throw new Error("Provide between 1 and 24 field phrases.");
      return request.params.phrases.map((phrase) => withAllianceView(resolveProjectFieldTerm(phrase, snapshot.project.strategy, {
        alliance: request.params.alliance,
        defaultAlliance: snapshot.allianceView,
        allianceView: snapshot.allianceView,
        pose: request.params.pose,
        relativeDistanceM: request.params.relativeDistanceM,
        robotHeightM: snapshot.project.robot.heightM ?? request.params.robotHeightM,
      }), snapshot.allianceView));
    }
    const pathId = "pathId" in request.params && request.params.pathId ? request.params.pathId : snapshot.activePathId;
    if (request.method === "analyze_path") {
      return analyzePath(snapshot.project, pathId, {
        plannerId: snapshot.plannerId,
        sampleLimit: request.params.sampleLimit,
        minimumClearanceM: request.params.minimumClearanceM,
      });
    }
    if (request.method === "repair_path") {
      const candidates = generateRepairCandidates(snapshot.project, pathId, request.params.findingIds, snapshot.plannerId, request.params.minimumClearanceM);
      if (candidates.length === 0) throw new Error("Bordeaux could not generate a targeted repair for those findings without changing unrelated intent.");
      const valid = candidates.filter((candidate) => candidate.valid);
      const proposal: PathProposal = {
        id: `proposal_${randomUUID()}`,
        baseSessionId: snapshot.sessionId,
        baseRevision: snapshot.revision,
        intent: `Repair ${request.params.findingIds.join(", ")} on ${pathId}`,
        operation: "replace",
        targetPathId: pathId,
        candidates,
        recommendedCandidateId: (valid[0] ?? candidates[0]).id,
        recommendationReason: valid.length
          ? `${valid[0].label} materially improves the requested finding without introducing a worse error or warning.`
          : "No generated repair passed the no-worse validation; the first candidate is shown only for diagnosis.",
        status: "ready",
        createdAt: new Date().toISOString(),
      };
      return this.stage(proposal);
    }
    if (request.method !== "plan_path") throw new Error("Unsupported Bordeaux agent request.");
    if (request.params.endAction && request.params.endActionIntent) throw new Error("Provide either a verified endAction binding or an unresolved endActionIntent, not both.");
    const endSemanticTag = request.params.endAction?.semanticTag ?? request.params.endActionIntent?.semanticTag;
    if (endSemanticTag === "shoot-fuel" && snapshot.project.robot.planning?.shooter?.requiresTargetFacing && !request.params.finishFacing) {
      throw new Error("This robot profile requires target-facing shooter alignment. Add finishFacing with an official HUB reference before requesting shoot-fuel.");
    }
    const candidates = generateRouteCandidates(snapshot.project, request.params, snapshot.plannerId);
    if (candidates.length === 0) throw new Error("Bordeaux could not generate route candidates for that request.");
    if (request.params.endAction) {
      const catalog = this.getJavaCatalog();
      if (!catalog?.authoritative) throw new Error("Link and build an authoritative Java command catalog before binding an end action.");
      const endAction = request.params.endAction;
      const tagged = catalog.commands.filter((item) => item.runtimeReady === true && item.semanticTags?.includes(endAction.semanticTag));
      const binding = snapshot.project.strategy?.actionBindings?.find((item) => item.semanticTag === endAction.semanticTag);
      if (!binding && tagged.length !== 1) throw new Error(`Semantic action ${endAction.semanticTag} must match exactly one runtime-ready command or have one explicit project strategy binding; found ${tagged.length}.`);
      const selectedCommandId = binding?.commandId ?? tagged[0].id;
      if (endAction.commandId !== selectedCommandId) throw new Error(`Semantic action ${endAction.semanticTag} is explicitly bound to ${selectedCommandId}, not ${endAction.commandId}.`);
      const command = catalog.commands.find((item) => item.id === selectedCommandId && item.runtimeReady === true);
      if (!command) throw new Error("The requested end action is not a runtime-ready command in the linked catalog.");
      if (!command.semanticTags?.includes(endAction.semanticTag)) throw new Error(`Command ${command.id} does not explicitly advertise ${endAction.semanticTag}.`);
      const invocation = {
        commandId: command.id,
        arguments: endAction.arguments ?? defaultJavaCommandArguments(command),
        cancelOnPathEnd: endAction.cancelOnPathEnd,
      };
      const invocationErrors = javaInvocationErrors(invocation, command);
      if (invocationErrors.length) throw new Error(`End action is invalid: ${invocationErrors.join("; ")}`);
      candidates.forEach((candidate) => {
        candidate.path.markers.push({ id: `event_${randomUUID()}`, f: 1, name: command.label, invocation });
        candidate.analysis.authoredPath = candidate.path;
      });
    }
    if (request.params.endActionIntent) {
      const actionIntent = request.params.endActionIntent;
      candidates.forEach((candidate) => {
        candidate.path.markers.push({
          id: `event_${randomUUID()}`,
          f: 1,
          name: actionIntent.description,
          cmd: "none",
          group: "sequential",
          actionIntent: { ...actionIntent },
        });
        candidate.analysis.authoredPath = candidate.path;
      });
    }
    const valid = candidates.filter((candidate) => candidate.valid);
    const recommendedCandidateId = (valid[0] ?? candidates[0]).id;
    const advisories = request.params.endActionIntent ? [
      `Action pending: “${request.params.endActionIntent.description}” (${request.params.endActionIntent.semanticTag}) is preserved at the path endpoint but has no robot command yet. Link an authoritative Java command before export.`,
    ] : [];
    const proposal: PathProposal = {
      id: `proposal_${randomUUID()}`,
      baseSessionId: snapshot.sessionId,
      baseRevision: snapshot.revision,
      intent: request.params.intent,
      operation: "add",
      candidates,
      recommendedCandidateId,
      recommendationReason: routeRecommendationReason(candidates, recommendedCandidateId),
      ...(advisories.length ? { advisories } : {}),
      status: "ready",
      createdAt: new Date().toISOString(),
    };
    return this.stage(proposal);
  }
}
