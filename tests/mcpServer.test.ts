import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { AgentRequest } from "../src/electron/agentSession";
import { buildMcpServer } from "../src/mcp/server";

describe("Bordeaux MCP surface", () => {
  it("lists the safe tool boundary and forwards structured requests", async () => {
    const requests: AgentRequest[] = [];
    const server = buildMcpServer({ request: async (request) => { requests.push(request); return { ok: true, method: request.method }; } });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["inspect_session", "inspect_robot_profile", "propose_robot_profile", "resolve_field_terms", "analyze_path", "repair_path", "plan_path", "get_proposal"]));
      expect(tools.tools.map((tool) => tool.name)).not.toContain("save_project");
      const authoring = await client.readResource({ uri: "bordeaux://guidance/path-authoring" });
      expect(authoring.contents[0]).toMatchObject({ mimeType: "application/json" });
      expect("text" in authoring.contents[0] ? authoring.contents[0].text : "").toContain("72 inches deep");
      expect("text" in authoring.contents[0] ? authoring.contents[0].text : "").toContain("configured robot footprint and height");
      const prompt = await client.getPrompt({ name: "author_autonomous_path" });
      expect(prompt.messages[0].content).toMatchObject({ type: "text" });
      expect(prompt.messages[0].content.type === "text" ? prompt.messages[0].content.text : "").toContain("much shallower than the full 283-inch NEUTRAL ZONE");
      expect(prompt.messages[0].content.type === "text" ? prompt.messages[0].content.text : "").toContain("allows valid geometry to be added");
      expect(prompt.messages[0].content.type === "text" ? prompt.messages[0].content.text : "").toContain("mark collectFuel only on steps intended to sweep ball-bearing space");
      expect(prompt.messages[0].content.type === "text" ? prompt.messages[0].content.text : "").toContain("across the full half through the CENTER LINE");
      const setupPrompt = await client.getPrompt({ name: "configure_robot_for_planning" });
      expect(setupPrompt.messages[0].content.type === "text" ? setupPrompt.messages[0].content.text : "").toContain("Do not guess");
      const result = await client.callTool({ name: "inspect_session", arguments: {} });
      expect(result.structuredContent).toMatchObject({ result: { ok: true, method: "inspect_session" } });
      expect(requests[0]).toEqual({ method: "inspect_session" });
      await client.callTool({ name: "plan_path", arguments: {
        intent: "Drive and shoot", alliance: "blue", goals: [{ x: 3, y: 1 }],
        endAction: { commandId: "robot.shoot", semanticTag: "shoot-fuel" },
      } });
      expect(requests[1]).toMatchObject({ method: "plan_path", params: { endAction: { commandId: "robot.shoot", semanticTag: "shoot-fuel" } } });
      await client.callTool({ name: "plan_path", arguments: {
        intent: "Mixed route", alliance: "red", start: { term: "red left trench" },
        steps: [
          { kind: "swoosh", at: { term: "far side of the neutral zone" }, traversal: "trench-table", turn: "clockwise", radiusM: 0.8, insetM: 1, collectFuel: { maxHeadingErrorDeg: 8 } },
          { kind: "travel", to: { x: 2.2, y: 5.45 }, traversal: "bump-table" },
        ],
        endActionIntent: { semanticTag: "shoot-fuel", description: "shoot into the red HUB" },
      } });
      expect(requests[2]).toMatchObject({ method: "plan_path", params: { steps: [{ kind: "swoosh", collectFuel: { maxHeadingErrorDeg: 8 } }, { kind: "travel" }], endActionIntent: { semanticTag: "shoot-fuel" } } });
      const conflictingTraversal = await client.callTool({ name: "plan_path", arguments: {
        intent: "Conflicting route", alliance: "red", steps: [{ kind: "travel", to: { x: 8, y: 4 }, traversal: "bump-table" }], traversal: "trench",
      } });
      expect(conflictingTraversal.isError).toBe(true);
      const invalidPose = await client.callTool({ name: "resolve_field_terms", arguments: { phrases: ["front of bot"], pose: { headingSource: "physical", x: -1, y: 1, physicalHeadingRad: 0 } } });
      expect(invalidPose.isError).toBe(true);
      await client.callTool({ name: "propose_robot_profile", arguments: {
        intent: "Configure the front intake",
        planning: { intake: { name: "Front intake", centerM: { x: 0.42, y: 0 }, directionDeg: 0, captureWidthM: 0.7, maxCollectSpeedMps: 2 } },
      } });
      expect(requests.at(-1)).toMatchObject({ method: "propose_robot_profile", params: { planning: { intake: { directionDeg: 0, maxCollectSpeedMps: 2 } } } });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
