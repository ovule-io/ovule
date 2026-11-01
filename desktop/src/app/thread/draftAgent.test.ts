import { expect, test } from "bun:test";
import type { AgentView, HostView } from "@ovule/shell-api";
import { resolveDraftAgent } from "./draftAgent";
const agents = ["first", "default", "remote"].map((id) => ({ id, enabled: true })) as AgentView[];
const hosts = [
  { id: "local", agentIds: ["first", "default"] },
  { id: "peer", agentIds: ["remote"] },
] as HostView[];
test("new conversations select the configured default and preserve explicit choices", () => {
  expect(resolveDraftAgent(agents, hosts, "local", "", "default")).toBe("default");
  expect(resolveDraftAgent(agents, hosts, "local", "first", "default")).toBe("first");
});
test("host changes and disabled profiles cannot keep an invalid Agent selection", () => {
  expect(resolveDraftAgent(agents, hosts, "peer", "first", "default")).toBe("remote");
  expect(
    resolveDraftAgent(
      agents.map((agent) => ({ ...agent, enabled: agent.id !== "default" })),
      hosts,
      "local",
      "",
      "default",
    ),
  ).toBe("first");
  expect(resolveDraftAgent(agents, hosts, "missing", "", "default")).toBe("");
});
