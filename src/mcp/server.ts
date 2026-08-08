import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import type { AgentRequest } from "../electron/agentSession";
import { FIELD_H, FIELD_W } from "../shared/math/fieldBounds";

export interface BordeauxMcpBridge {
  request(request: AgentRequest): Promise<unknown>;
}

function textResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }], structuredContent: { result: value as any } };
}

function jsonResource(uri: URL, value: unknown) {
  return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(value, null, 2) }] };
}

export function buildMcpServer(bridge: BordeauxMcpBridge): McpServer {
  const server = new McpServer({ name: "Bordeaux", version: "0.1.0" });
  server.registerResource("Current Bordeaux session", "bordeaux://session/current", { mimeType: "application/json", description: "Current live editor session, active path, planner, robot, and revision." }, async (uri) => jsonResource(uri, await bridge.request({ method: "inspect_session" })));
  server.registerResource("Robot planning profile", "bordeaux://robot/planning-profile", { mimeType: "application/json", description: "Configured intake/shooter geometry plus the unanswered setup questions an agent should ask the team." }, async (uri) => jsonResource(uri, await bridge.request({ method: "inspect_robot_profile" })));
  server.registerResource("2026 REBUILT field", "bordeaux://field/2026-rebuilt", { mimeType: "application/json", description: "Source-pinned field vocabulary and geometry with explicit Bordeaux display transform." }, async (uri) => jsonResource(uri, await bridge.request({ method: "field_pack" })));
  server.registerResource("Path authoring contract", "bordeaux://guidance/path-authoring", { mimeType: "application/json", description: "Required coordinate, vocabulary, ordered-route, maneuver, and action-binding rules for every fresh agent context." }, async (uri) => jsonResource(uri, {
    coordinateFrame: "Canonical Bordeaux coordinates match the overhead image: red is left/low-X, blue is right/high-X, and +Y is screen-up. Red view rotates only the displayed overlay.",
    rules: [
      "Inspect the live session and field pack before planning.",
      "An explicit red/blue phrase selects physical ownership and must never be replaced by allianceView.",
      "Resolve alliance-left/right through vocabulary; never infer it from screen left/right.",
      "Use ordered steps when outbound and inbound crossings differ. Never compress mixed TRENCH/BUMP intent into one global traversal.",
      "Represent swoosh as the typed 180-degree maneuver with explicit clockwise/counterclockwise direction and radius. Use insetM at a zone boundary to preserve robot-footprint clearance; never invent a free-form loop.",
      "When the user wants to collect initial FUEL, preserve collection as the route objective and use the official initial FUEL staging band (approximately 72 inches deep around the CENTER LINE), not the full 283-inch NEUTRAL ZONE depth. Resolve its near/far edge explicitly. If the user selects one field half, distribute distinct lanes across that half through the CENTER LINE using the configured intake capture width and footprint, rather than hugging the wall-side edge or retracing one lane.",
      "A proposal must validate the exact ordered portal sequence before it can be recommended.",
      "Preserve requested robot actions. Use endAction only after an authoritative Java binding; otherwise use endActionIntent so Bordeaux retains a pending endpoint marker while allowing valid path geometry to be added.",
      "Plan against the configured robot footprint and height. Never replace project dimensions with a guessed centerline radius; BUMPs are traversable portals, TRENCHes are width- and height-limited portals, and HUBs plus field walls are solid.",
      "The field pack also inventories DEPOTS, OUTPOST CHUTE/CORRAL, TOWER RUNGS, DRIVER STATIONS, official off-field areas, HUB faces, and AprilTags 1-32. Respect navigable:false; a tag or structure face is a perception/aiming reference, not a chassis pose. DEPOT barrier dimensions are known but its floor polygon is intentionally uncertified, so do not invent one.",
      "Before planning FUEL collection, inspect the robot planning profile. Ask the returned missing questions, then stage the answers with propose_robot_profile for explicit in-app approval.",
      "For collection, set collectFuel only on route steps intended to sweep ball-bearing space. Bordeaux clips intake heading and the configured collection-speed cap to the portions of those steps inside the official initial-FUEL region; approach, exit, and BUMP travel outside that region keep their own limits. Do not author a crosswise collection heading unless the user explicitly approves allowCrosswiseHeading.",
      "Use smooth, lane-following waypoint tangents. Heading describes the robot's physical orientation; it is not interchangeable with the curve tangent unless the configured mechanism direction makes them equivalent.",
      "When shooting ends a route, use finishFacing with the configured shooter and physical HUB target. Bordeaux begins the HUB-facing rotation only after leaving the final collection lane and completes it while driving; it must not manufacture visible low-speed heading-transition ranges or defer the whole turn until after stopping.",
    ],
  }));
  server.registerResource("Current Java commands", "bordeaux://commands/current", { mimeType: "application/json", description: "Authoritative linked Java commands, or an empty catalog when none is linked." }, async (uri) => jsonResource(uri, await bridge.request({ method: "commands" })));
  server.registerResource("Path analysis", new ResourceTemplate("bordeaux://paths/{id}/analysis", { list: undefined }), { mimeType: "application/json", description: "Authored path data, bounded raw planner samples, extrema, and measured findings." }, async (uri, variables) => jsonResource(uri, await bridge.request({ method: "analyze_path", params: { pathId: String(variables.id) } })));
  server.registerResource("Proposal", new ResourceTemplate("bordeaux://proposals/{id}", { list: undefined }), { mimeType: "application/json", description: "A staged path or repair proposal and its current application status." }, async (uri, variables) => jsonResource(uri, await bridge.request({ method: "get_proposal", params: { proposalId: String(variables.id) } })));

  server.registerTool("inspect_session", { description: "Inspect the live Bordeaux project without changing it.", inputSchema: z.object({}), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } }, async () => textResult(await bridge.request({ method: "inspect_session" })));
  server.registerTool("inspect_robot_profile", { description: "Inspect the agent-only robot planning details and get the exact unanswered questions needed before planning collection or shooting.", inputSchema: z.object({}), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } }, async () => textResult(await bridge.request({ method: "inspect_robot_profile" })));
  const robotPlanningProfile = z.object({
    intake: z.object({
      name: z.string().min(1).max(80),
      centerM: z.object({ x: z.number(), y: z.number() }).describe("Robot-local meters: +X forward, +Y left."),
      directionDeg: z.number().min(-180).max(180).describe("Outward collection direction counterclockwise from robot +X; front is 0 degrees."),
      captureWidthM: z.number().positive().max(3),
      maxCollectSpeedMps: z.number().positive().max(12),
    }).optional(),
    shooter: z.object({
      directionDeg: z.number().min(-180).max(180).describe("Firing direction counterclockwise from robot +X; front is 0 degrees."),
      requiresTargetFacing: z.boolean(),
      preferredRangeM: z.number().positive().max(20).optional(),
    }).optional(),
    notes: z.string().max(4_000).optional(),
  });
  server.registerTool("propose_robot_profile", {
    description: "Stage team-provided intake, shooter, and planning details for explicit review on Bordeaux's Robot page. Omitted fields retain the inspected profile; this never changes the project directly.",
    inputSchema: z.object({ intent: z.string().min(1).max(1_000), planning: robotPlanningProfile }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => textResult(await bridge.request({ method: "propose_robot_profile", params: args })));
  server.registerTool("resolve_field_terms", {
    description: "Resolve game-manual and robot-relative vocabulary to authoritative field locations. Explicit red/blue ownership is independent of the editor view; alliance-left/right on a TRENCH/BUMP is driver-relative. Robot-relative front/back/left/right requires a pose.",
    inputSchema: z.object({
      phrases: z.array(z.string().min(1).max(160)).min(1).max(24),
      alliance: z.enum(["blue", "red"]).optional(),
      pose: z.discriminatedUnion("headingSource", [
        z.object({ headingSource: z.literal("physical"), x: z.number().min(0).max(FIELD_W), y: z.number().min(0).max(FIELD_H), physicalHeadingRad: z.number() }),
        z.object({ headingSource: z.literal("authored"), x: z.number().min(0).max(FIELD_W), y: z.number().min(0).max(FIELD_H), authoredHeadingRad: z.number(), driveBackward: z.boolean() }),
      ]).optional(),
      relativeDistanceM: z.number().min(0.01).max(5).optional(),
      robotHeightM: z.number().positive().max(5).optional().describe("Fallback height only for migrated projects whose robot configuration has no height; configured project height is authoritative."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (args) => textResult(await bridge.request({ method: "resolve_field_terms", params: args })));
  server.registerTool("analyze_path", {
    description: "Analyze an existing live path through Bordeaux's selected planner and return raw sampled values, extrema, and measured findings without mutation.",
    inputSchema: z.object({ pathId: z.string().max(160).optional(), sampleLimit: z.number().int().min(50).max(2_000).optional(), minimumClearanceM: z.number().min(0).max(2).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (args) => textResult(await bridge.request({ method: "analyze_path", params: args })));
  server.registerTool("repair_path", {
    description: "Generate bounded repairs for named analysis findings and stage them in Bordeaux for user review. This never applies a project change.",
    inputSchema: z.object({ pathId: z.string().max(160).optional(), findingIds: z.array(z.string().min(1).max(200)).min(1).max(8), minimumClearanceM: z.number().min(0).max(2).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => textResult(await bridge.request({ method: "repair_path", params: args })));
  const location = z.union([z.object({ x: z.number(), y: z.number(), headingDeg: z.number().optional() }), z.object({ term: z.string().min(1).max(160) })]);
  const legTraversal = z.enum(["direct", "trench-table", "trench-away", "bump-table", "bump-away"]);
  const collectFuel = z.object({
    maxHeadingErrorDeg: z.number().min(1).max(90).optional().describe("Maximum intake-to-travel heading error; defaults to 5 degrees."),
    allowCrosswiseHeading: z.boolean().optional().describe("Only true when the user explicitly wants a non-aligned collection strategy."),
  });
  const routeStep = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("travel"), to: location, traversal: legTraversal.optional(), collectFuel: collectFuel.optional() }),
    z.object({
      kind: z.literal("swoosh"),
      at: location.describe("Far longitudinal extent of the 180-degree maneuver, not its entry or center."),
      traversal: legTraversal.optional().describe("Exact portal used on the approach leg when it reaches an alliance barrier."),
      turn: z.enum(["clockwise", "counterclockwise"]).describe("Turn direction as viewed in canonical Bordeaux overhead coordinates (+X right, +Y up)."),
      radiusM: z.number().min(0.25).max(2.5).describe("Radius of the 180-degree reversal in meters."),
      insetM: z.number().min(0).max(2).optional().describe("Distance to move the far extent back along the approach from a named zone boundary."),
      collectFuel: collectFuel.optional(),
    }),
  ]);
  server.registerTool("plan_path", {
    description: "Stage planner-scored path previews. Use ordered steps for mixed crossings or a swoosh and mark collectFuel only on steps that sweep ball-bearing space. Bordeaux spatially clips intake heading and the configured intake-speed cap to the official FUEL region, leaving approaches and exits uncapped by intake speed. For initial FUEL collection, target the approximately 72-inch-deep staging band around the CENTER LINE rather than the full NEUTRAL ZONE depth, and distribute lanes across the requested field half through the CENTER LINE using the configured intake width. This is not a global optimum.",
    inputSchema: z.object({
      intent: z.string().min(1).max(2_000), name: z.string().max(120).optional(), alliance: z.enum(["blue", "red"]), start: location.optional(), goals: z.array(location).min(1).max(12).optional(), steps: z.array(routeStep).min(1).max(12).optional(),
      traversal: z.enum(["fastest", "trench", "bump", "compare"]).optional(), minimumClearanceM: z.number().min(0).max(2).optional().describe("Advisory clearance target used for warnings and near-tie ranking; modeled intersections remain invalid."), maximumCandidates: z.number().int().min(1).max(5).optional(), nearTieWindowS: z.number().min(0).max(2).optional(), basePathId: z.string().max(160).optional(),
      robotHeightM: z.number().positive().max(5).optional().describe("Fallback height only for migrated projects whose robot configuration has no height; configured project height is authoritative."),
      collectFuel: collectFuel.optional().describe("Legacy-goals shorthand only. Ordered routes should mark each collecting travel/swoosh step instead."),
      finishFacing: z.object({ mechanism: z.literal("shooter"), target: location, maxHeadingErrorDeg: z.number().min(1).max(45).optional() }).optional().describe("Mechanism-aware physical heading at the final pose. Use a separate non-collecting final travel step."),
      endAction: z.object({ commandId: z.string().min(1).max(256), semanticTag: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), arguments: z.record(z.string(), z.json()).optional(), cancelOnPathEnd: z.boolean().optional() }).optional(),
      endActionIntent: z.object({ semanticTag: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), description: z.string().min(1).max(200) }).optional(),
    }).refine((value) => Boolean(value.goals) !== Boolean(value.steps), { message: "Provide exactly one of goals or ordered steps." }).refine((value) => !(value.steps && value.traversal), { message: "Ordered steps use per-leg traversal and cannot include global traversal." }).refine((value) => !(value.endAction && value.endActionIntent), { message: "Provide endAction or endActionIntent, not both." }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => textResult(await bridge.request({ method: "plan_path", params: args })));
  server.registerTool("get_proposal", {
    description: "Read a staged proposal's candidates, diagnostics, recommendation, and current status.",
    inputSchema: z.object({ proposalId: z.string().min(1).max(200) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (args) => textResult(await bridge.request({ method: "get_proposal", params: args })));
  server.registerPrompt("configure_robot_for_planning", { description: "Interview the team for missing robot facts, then stage a reviewable Robot-page proposal." }, async () => ({ messages: [{ role: "user", content: { type: "text", text: "Read bordeaux://robot/planning-profile and bordeaux://session/current. Ask only the missing questions returned by the profile resource: primary intake robot-local center and direction, effective capture width, maximum safe collection speed, and—when shooting matters—shooter direction, target-facing requirement, and preferred range. Explain that +X is robot forward, +Y is robot left, and directions are counterclockwise degrees from +X. Do not guess. After the user answers, call propose_robot_profile. Tell the user to review and apply it on Bordeaux's Robot page; never apply, save, or export it yourself." } }] }));
  server.registerPrompt("author_autonomous_path", { description: "Required safe workflow for coordinate-correct, topology-preserving path authoring and in-app approval." }, async () => ({ messages: [{ role: "user", content: { type: "text", text: "Read bordeaux://session/current, bordeaux://robot/planning-profile, bordeaux://field/2026-rebuilt, and bordeaux://guidance/path-authoring before planning. If the robot profile reports missing facts relevant to the request, ask the user those exact questions and stage their answers with propose_robot_profile; never guess mechanism geometry. Canonical Bordeaux coordinates match the overhead image: red is left/low-X and blue is right/high-X; allianceView changes display orientation only and never landmark ownership. Official +Y is away from the scoring table. Resolve every game-manual term explicitly and respect navigable:false on fiducials, structure faces, and off-field areas. Treat alliance-left/right as driver-relative vocabulary, not screen-relative guessing. Plan against the configured robot-local footprint and height: the full oriented polygon must fit, BUMPs are traversable surfaces with full depth, TRENCHes are width- and height-limited overhead passages, and HUBs plus field walls are solid. Never substitute a guessed centerline radius or an uncertified DEPOT polygon. If outbound and inbound crossings differ, use ordered steps with a traversal on each leg; never use legacy goals or a single global traversal. Encode a swoosh only with the typed 180-degree swoosh step, explicit turn direction, radius, and a footprint-safe inset when its named extent is a zone boundary—never with guessed loop coordinates. If the user wants to collect initial FUEL, keep collection as the route objective, mark collectFuel only on steps intended to sweep ball-bearing space, and resolve both edges of the official approximately 72-inch-deep FUEL band around the CENTER LINE. This band is much shallower than the full 283-inch NEUTRAL ZONE. Route the outbound and return lanes inside that green region. If one field half is requested, distribute those lanes across the full half through the CENTER LINE using the configured intake capture width and robot footprint; do not hug only the wall-side portion. Bordeaux clips the intake-speed and intake-heading rules to the actual in-region portions, so never extend collection caps through empty approaches, TRENCHes, BUMPs, or alliance zones. Use distinct collection lanes with little retracing. Treat authored heading as physical robot orientation. Tangents control geometry, while swerve heading may rotate independently after collection. Use finishFacing so Bordeaux begins rotating toward the HUB after leaving the final FUEL lane and completes the alignment while still driving; never request manufactured low-speed heading-transition ranges or a full stationary endpoint turn. Confirm the proposal's requiredPortalIds match the requested order before recommending it. Preserve requested actions: bind endAction only through an authoritative Java command; otherwise send endActionIntent so Bordeaux saves a pending endpoint marker, allows valid geometry to be added, and requires binding before Java export. Analyze existing paths before repairs, recommend only a valid candidate, and tell the user to review Apply/Reject in Bordeaux. Never claim global optimality or attempt file, export, build, or deploy operations." } }] }));
  return server;
}

export function serveBordeauxMcp(bridge: BordeauxMcpBridge) {
  return serveStdio(() => buildMcpServer(bridge), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 1024 * 1024 }),
    onerror: (error) => console.error("Bordeaux MCP error:", error instanceof Error ? error.message : String(error)),
  });
}
