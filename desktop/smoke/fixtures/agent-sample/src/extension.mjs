import { defineAgent, defineExtension, result } from "@ovule/extension";
export default defineExtension({
  id: "io.ovule.agent.sample",
  apiVersion: 1,
  capabilities: ["agent-driver", "acp"],
  agents: {
    sample: defineAgent({
      prepare(input) {
        return {
          executableCandidates: ["sample", "sample-alias"],
          args: [
            ...(input?.model?.remoteId ? ["--model", input.model.remoteId] : []),
            "acp",
            "serve",
          ],
          cwd: "workspace",
          environment: [{ name: "NO_COLOR", value: "1" }],
          stdin: "jsonl-rpc",
          output: "plain",
        };
      },
      onStdout: (state) => result(state),
      onStderr: (state) => result(state),
      onExit: (state) => result(state),
    }),
  },
});
