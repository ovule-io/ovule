import { defineChannel, defineExtension, result } from "@ovule/extension";
export default defineExtension({
  id: "io.ovule.channel.sample",
  apiVersion: 1,
  capabilities: ["channel"],
  channels: {
    channel: defineChannel({
      setup: () => ({
        regions: ["global"],
        secretFields: ["app_id", "app_secret"],
        transport: "websocket",
        worker: {
          module: "dist/host/worker.mjs",
          executableCandidates: ["node"],
          toolchain: "nodejs",
          protocol: "jsonl-rpc",
        },
      }),
      connect: () =>
        result(
          {},
          [],
          [
            {
              id: "connect",
              kind: "transport.http.request",
              input: { endpoint: "https://api.example.com/connect", method: "POST" },
            },
          ],
        ),
      onTransportEvent: (state, event) =>
        result(state, [{ kind: "message.received", payload: event.payload }]),
      deliver: (state) => result(state),
      onTimer: (state) => result(state),
      shutdown: (state) => result(state),
    }),
  },
});
