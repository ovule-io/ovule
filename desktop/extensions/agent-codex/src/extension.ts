import { defineAgent, defineExtension, result } from "@ovule/extension";
import type { AgentAdapter, JsonValue } from "@ovule/extension";

const extension = {
  prepare: (_input: JsonValue) => ({
    executableCandidates: ["codex-acp"],
    args: [],
    cwd: "workspace" as const,
    environment: [{ name: "NO_COLOR", value: "1" }],
    stdin: "jsonl-rpc" as const,
    output: "plain" as const,
  }),
  onStdout: (state: JsonValue) => result(state),
  onStderr: (state: JsonValue) => result(state),
  onExit: (state: JsonValue) => result(state),
} satisfies AgentAdapter;

export default defineExtension({
  id: "io.ovule.agent.codex",
  apiVersion: 1,
  capabilities: ["agent-driver", "acp"],
  agents: { codex: defineAgent(extension) },
});
