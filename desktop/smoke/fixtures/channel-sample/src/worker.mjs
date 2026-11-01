// Synthetic worker: no network client or provider SDK.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
let configured = false,
  connected = false,
  setup = {};
const bot = { name: "Sample bot", openId: "test-bot" };
const provisioning = {
  ready: true,
  ok: true,
  verified: true,
  published: true,
  state: "ready",
  websocket: true,
  eventSubscribed: true,
  scopesReady: true,
  missing: [],
};
const write = (value) => process.stdout.write(JSON.stringify({ version: 1, ...value }) + "\n");
const emit = (event, payload) => write({ type: "event", event, payload });
function log(event, data) {
  if (process.env.OVULE_CHANNEL_WORKER_MOCK_LOG)
    appendFileSync(
      process.env.OVULE_CHANNEL_WORKER_MOCK_LOG,
      JSON.stringify({ event, ...data }) + "\n",
    );
}
function inbound(content, suffix) {
  const message = {
    messageId: `test-message-${suffix}`,
    chatId: "test-chat",
    chatType: "p2p",
    senderId: "test-owner",
    senderName: "Test owner",
    content,
    rawContentType: "text",
    createTime: Date.now(),
  };
  log("inbound", message);
  emit("message", message);
}
async function handle({ version, id, method, params = {} }) {
  if (version !== 1 || typeof id !== "string") throw new Error("Invalid test worker envelope");
  let result;
  switch (method) {
    case "startRegistration":
      result = { started: true, url: "https://example.com/authorize", expireIn: 600 };
      setTimeout(
        () =>
          emit("registration", {
            state: "succeeded",
            appId: "test-app",
            appSecret: "test-secret",
            region: "global",
          }),
        25,
      );
      break;
    case "cancelRegistration":
      result = { cancelled: true };
      break;
    case "configure":
      configured = true;
      setup = params;
      result = { configured, region: "global" };
      break;
    case "provision":
    case "checkProvisioning":
      result = provisioning;
      break;
    case "connect":
      connected = true;
      result = { connected, bot };
      emit("health", { state: "connected", bot });
      if (process.env.OVULE_CHANNEL_WORKER_MOCK_E2E === "1") {
        const hash = createHash("sha256")
          .update("ovule-channel-owner-v1\0")
          .update(setup.appId)
          .update("\0")
          .update(setup.appSecret)
          .digest();
        const code = String(hash.readUInt32BE(0) % 1_000_000).padStart(6, "0");
        setTimeout(() => inbound(`/pair ${code}`, "pair"), 100);
        setTimeout(() => inbound("CHANNEL_AGENT_ROUND_TRIP_OK", "turn"), 600);
      }
      break;
    case "status":
      result = { configured, connected, provisioning };
      break;
    case "send":
      log("send", params);
      result = { messageId: `test-delivery-${params.deliveryId ?? id}`, sent: true };
      emit("delivery", { deliveryId: params.deliveryId, state: "delivered", ...result });
      break;
    case "sendProgress":
      result = { messageId: `progress-${params.attemptId}`, sent: true };
      break;
    case "updateProgress":
      result = { updated: true };
      break;
    case "inject":
      emit("message", params.message);
      result = { accepted: true };
      break;
    case "shutdown":
      connected = false;
      result = { stopped: true };
      break;
    default:
      throw new Error(`Unknown test worker method: ${method}`);
  }
  write({ type: "response", id, ok: true, result });
  if (method === "shutdown") process.exit(0);
}
for await (const line of createInterface({ input: process.stdin })) {
  let command;
  try {
    command = JSON.parse(line);
    await handle(command);
  } catch (error) {
    write({
      type: "response",
      id: command?.id,
      ok: false,
      error: { code: "test_worker_error", message: error.message },
    });
  }
}
