import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineAgent,
  defineChannel,
  defineExtension,
  defineModelProvider,
  messageBlock,
  result,
  validateManifest,
} from "./runtime.mjs";
import sample from "../../smoke/fixtures/agent-sample/dist/extension.mjs";
import codex from "../../extensions/agent-codex/dist/extension.mjs";
import deepseek from "../../extensions/agent-deepseek/dist/extension.mjs";
import channel from "../../smoke/fixtures/channel-sample/dist/extension.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
for (const [base, directory, extension, contribution] of [
  ["smoke/fixtures", "agent-sample", sample, "agents"],
  ["extensions", "agent-codex", codex, "agents"],
  ["extensions", "agent-deepseek", deepseek, "models"],
  ["smoke/fixtures", "channel-sample", channel, "channels"],
]) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "..", "..", base, directory, "extension.json"), "utf8"),
  );
  const packageManifest = JSON.parse(
    await fs.readFile(path.join(root, "..", "..", base, directory, "package.json"), "utf8"),
  );
  const source = await fs.readFile(
    path.join(
      root,
      "..",
      "..",
      base,
      directory,
      "src",
      base === "smoke/fixtures" ? "extension.mjs" : "extension.ts",
    ),
    "utf8",
  );
  const distribution = await fs.readFile(
    path.join(root, "..", "..", base, directory, "dist", "extension.mjs"),
    "utf8",
  );
  assert.equal(validateManifest(manifest, extension.describe()), true);
  assert.ok(manifest.contributes[contribution].length > 0);
  assert.equal(manifest.runtime.entry, "dist/extension.mjs");
  assert.equal(
    packageManifest.dependencies["@ovule/extension"],
    base === "smoke/fixtures" ? "^0.1.0" : "workspace:*",
  );
  assert.match(source, /from "@ovule\/extension"/);
  assert.doesNotMatch(distribution, /@ovule\/extension|packages\/ovule-extension/);
}

for (const [directory, contribution] of [
  ["visuals", "messageBlocks"],
  ["visuals", "fileEditors"],
]) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(root, "..", "..", "extensions", directory, "extension.json"),
      "utf8",
    ),
  );
  assert.equal(validateManifest(manifest), true);
  assert.equal(manifest.runtime, undefined);
  assert.ok(manifest.contributes[contribution].length > 0);
}

assert.equal(sample.describe().id, "io.ovule.agent.sample");
assert.deepEqual(sample.describe().capabilities, ["agent-driver", "acp"]);
assert.deepEqual(sample.describe().handlers.agents, ["sample"]);
assert.equal(typeof sample.prepareAgent, "function");
const sampleManifest = JSON.parse(
  await fs.readFile(
    path.join(root, "..", "..", "smoke/fixtures", "agent-sample", "extension.json"),
    "utf8",
  ),
);
assert.equal(sampleManifest.contributes.toolchains[0].id, "sample");
assert.equal(sampleManifest.contributes.toolchains[0].provider.type, "external");
assert.deepEqual(sample.prepareAgent("sample", { model: { remoteId: "gpt-5" } }).args, [
  "--model",
  "gpt-5",
  "acp",
  "serve",
]);
assert.equal(codex.describe().id, "io.ovule.agent.codex");
assert.deepEqual(codex.describe().capabilities, ["agent-driver", "acp"]);
assert.deepEqual(codex.prepareAgent("codex", {}).executableCandidates, ["codex-acp"]);
assert.equal(deepseek.describe().id, "io.ovule.provider.deepseek");
const deepseekManifest = JSON.parse(
  await fs.readFile(
    path.join(root, "..", "..", "extensions", "agent-deepseek", "extension.json"),
    "utf8",
  ),
);
assert.deepEqual(
  deepseekManifest.contributes.models.map((model) => model.id),
  ["deepseek-flash", "deepseek-v4-pro"],
);
assert.deepEqual(deepseekManifest.contributes.agents, []);
assert.ok(
  deepseekManifest.contributes.models.every(
    (model) => model.provider === "deepseek" && model.agents.includes("ovule"),
  ),
);
assert.ok(deepseekManifest.permissions.secrets.includes("DEEPSEEK_API_KEY"));
assert.deepEqual(deepseekManifest.permissions.process, []);
assert.equal(deepseekManifest.contributes.onboarding[0].modelProvider, "deepseek");
assert.equal(
  deepseekManifest.contributes.onboarding[0].actions[0].handler,
  "model-provider.configure",
);
assert.equal(typeof deepseek.prepareModelProvider, "function");
assert.deepEqual(deepseek.prepareModelProvider("deepseek", { model: "deepseek-v4-special" }), {
  provider: "deepseek",
  apiBase: "https://api.deepseek.com",
  credentialReference: "DEEPSEEK_API_KEY",
  model: "deepseek-v4-special",
});
assert.deepEqual(deepseek.describe().capabilities, ["model-provider"]);
const codexManifest = JSON.parse(
  await fs.readFile(
    path.join(root, "..", "..", "extensions", "agent-codex", "extension.json"),
    "utf8",
  ),
);
assert.deepEqual(codexManifest.contributes.onboarding[0].agentIds, ["codex"]);
assert.equal(codexManifest.contributes.onboarding[0].modelProvider, "openai");
assert.deepEqual(
  codexManifest.contributes.toolchains.map((toolchain) => toolchain.id),
  ["codex", "codex-acp"],
);
const hostContributions = JSON.parse(
  await fs.readFile(
    path.join(root, "..", "..", "..", "crates", "ovule-extension-api", "src", "host.json"),
    "utf8",
  ),
);
assert.equal(hostContributions.onboarding[0].modelProvider, "ollama");
assert.equal(hostContributions.onboarding[0].actions[0].handler, "model-provider.pull");
const onboardingSource = await fs.readFile(
  path.join(root, "..", "..", "features", "settings", "src", "onboarding", "OnboardingPage.tsx"),
  "utf8",
);
assert.doesNotMatch(onboardingSource, /startOpenAiAuth|configureDeepSeek|renderOllamaSetup/);
assert.doesNotMatch(onboardingSource, /provider\s*===\s*["'](?:openai|deepseek|ollama)["']/);
assert.match(onboardingSource, /cleanOnboardingState/);
const catalogSource = await fs.readFile(
  path.join(root, "..", "..", "features", "settings", "src", "extensions", "ExtensionsSection.tsx"),
  "utf8",
);
assert.match(catalogSource, /installExtension/);
assert.match(catalogSource, /setExtensionEnabled/);
assert.match(catalogSource, /removeExtension/);
const applicationManifest = JSON.parse(
  await fs.readFile(path.join(root, "..", "..", "..", "tuffite.json"), "utf8"),
);
assert.deepEqual(applicationManifest.bundle.resources, ["LICENSE", "desktop/dist"]);
const packageSource = await fs.readFile(
  path.join(root, "..", "..", "..", "services", "extensions", "src", "packages.rs"),
  "utf8",
);
assert.doesNotMatch(packageSource, /load_packaged_plugins/);
assert.equal(channel.describe().id, "io.ovule.channel.sample");
const channelManifest = JSON.parse(
  await fs.readFile(
    path.join(root, "..", "..", "smoke/fixtures", "channel-sample", "extension.json"),
    "utf8",
  ),
);
assert.equal(channelManifest.contributes.toolchains[0].id, "channel-cli");
const channelCommand = channelManifest.contributes.slashCommands[0];
assert.equal(channelCommand.id, "channel");
assert.equal(channelCommand.handler, "channel.setup");
assert.deepEqual(channelCommand.skills, ["channel-channel", "channel-cli"]);
assert.equal(channelCommand.workflow, "workflows/setup.md");
assert.equal(channelCommand.statusBlock, "channel-setup");
assert.equal(channelCommand.fallback.title, "配置 Channel Bot");
assert.ok(channelCommand.fallback.nodes.length >= 4);
assert.deepEqual(channelManifest.contributes.skills, [
  { id: "channel-channel", path: "skills/channel-channel/SKILL.md" },
  { id: "channel-cli", path: "skills/channel-cli/SKILL.md" },
]);
assert.deepEqual(channelManifest.contributes.messageBlocks, [
  {
    kind: "channel-setup",
    hostRenderer: "channel-setup",
    agentInstructions:
      "Use this block only to display the live Channel channel setup state returned by Ovule. Never place credentials in the payload.",
    example: {
      extensionId: "io.ovule.channel.sample",
      state: "not_configured",
      detail: "Connect an existing channel app.",
    },
  },
]);
assert.ok(
  channelManifest.contributes.actions.some(
    (item) => item.id === "connect-existing" && item.reuseExisting === true,
  ),
);
const computerUseManifest = {
  ...codexManifest,
  runtime: undefined,
  permissions: { process: ["ollama"] },
  contributes: hostContributions,
};
assert.equal(validateManifest(computerUseManifest), true);
for (const patch of [
  { hostRenderer: "unknown" },
  { tag: "unsafe-host-mix" },
  { module: "dist/web/mixed.mjs" },
]) {
  const invalid = structuredClone(computerUseManifest);
  Object.assign(invalid.contributes.messageBlocks[0], patch);
  assert.throws(() => validateManifest(invalid), /Message Blocks are invalid/);
}
assert.equal(computerUseManifest.contributes.toolchains, undefined);
assert.deepEqual(computerUseManifest.contributes.computerUse, [
  {
    id: "computer-use",
    label: "CRD Computer Use",
    provider: "crd",
    backend: "native-crd",
    capabilities: ["desktop.snapshot", "desktop.input", "clipboard.write"],
    agents: [],
  },
]);
const officeManifest = JSON.parse(
  await fs.readFile(path.join(root, "..", "..", "extensions", "visuals", "extension.json"), "utf8"),
);
assert.deepEqual(
  officeManifest.contributes.fileEditors.flatMap((editor) => editor.extensions),
  ["docx", "dotx", "xlsx", "csv", "xlsm", "pptx", "pptm", "ppsx", "pdf"],
);
assert.ok(
  officeManifest.contributes.fileEditors.every((editor) => editor.threadPresentation === "card"),
);
assert.deepEqual(
  officeManifest.contributes.fileEditors
    .filter((editor) => editor.mode === "editable")
    .flatMap((editor) => editor.extensions),
  ["xlsx", "csv"],
);
const visualManifest = JSON.parse(
  await fs.readFile(path.join(root, "..", "..", "extensions", "visuals", "extension.json"), "utf8"),
);
assert.deepEqual(
  visualManifest.contributes.messageBlocks.map((item) => item.kind),
  ["echarts", "excalidraw", "interactive-ui"],
);
assert.ok(visualManifest.contributes.messageBlocks.every((item) => item.agentInstructions));
assert.ok(visualManifest.contributes.messageBlocks.every((item) => item.example));
// A combined package can mix transports, but each contribution must choose one.
for (const change of [
  (manifest) => {
    delete manifest.ui;
  },
  (manifest) => {
    manifest.ui.entry = "../outside.js";
  },
  (manifest) => {
    manifest.contributes.fileEditors[0].module = "dist/other.js";
  },
  (manifest) => {
    manifest.contributes.messageBlocks[2].module = "dist/ui.js";
  },
  (manifest) => {
    manifest.contributes.messageBlocks[0].ui.type = "unknown";
  },
]) {
  const invalid = structuredClone(visualManifest);
  change(invalid);
  assert.throws(() => validateManifest(invalid));
}
const iframeOnly = structuredClone(visualManifest);
iframeOnly.contributes = { messageBlocks: [iframeOnly.contributes.messageBlocks[2]] };
delete iframeOnly.ui;
assert.equal(validateManifest(iframeOnly), true, "iframe does not require an isolated snapshot");
assert.deepEqual(messageBlock("chart-1", "echarts", { series: [1, 2] }), {
  kind: "message.block",
  payload: { id: "chart-1", kind: "echarts", data: { series: [1, 2] } },
});
const connected = channel.connectChannel("channel", {
  region: "global",
  credentialBinding: "credential-1",
});
assert.equal(connected.operations[0].kind, "transport.http.request");
assert.equal(connected.operations[0].input.endpoint, "https://api.example.com/connect");
const inbound = channel.onChannelTransportEvent(
  "channel",
  {},
  {
    kind: "message",
    payload: { platformEventId: "event-1", senderId: "sender-1" },
  },
);
assert.equal(inbound.events[0].kind, "message.received");
assert.equal(inbound.events[0].payload.platformEventId, "event-1");
assert.equal(inbound.events[0].payload.senderId, "sender-1");

const multi = defineExtension({
  id: "io.ovule.multi",
  apiVersion: 1,
  capabilities: ["agent-driver", "model-provider", "messages"],
  agents: {
    multi: defineAgent({
      prepare: () => ({
        executableCandidates: ["multi"],
        args: [],
        cwd: "workspace",
        environment: [],
        stdin: "jsonl-rpc",
        output: "plain",
      }),
      onStdout: (state) => result(state),
      onStderr: (state) => result(state),
      onExit: (state) => result(state),
    }),
  },
  modelProviders: {
    multi: defineModelProvider({
      prepare: () => ({
        provider: "multi",
        apiBase: "https://multi.example",
        credentialReference: "MULTI_API_KEY",
        model: "multi-model",
      }),
    }),
  },
  channels: {
    multi: defineChannel({
      setup: () => ({}),
      connect: () => result(null),
      onTransportEvent: (state) => result(state),
      deliver: (state) => result(state),
      onTimer: (state) => result(state),
      shutdown: (state) => result(state),
    }),
  },
});
assert.deepEqual(multi.describe().handlers, {
  agents: ["multi"],
  modelProviders: ["multi"],
  channels: ["multi"],
});
assert.equal(
  validateManifest(
    {
      schemaVersion: 1,
      id: "io.ovule.multi",
      private: true,
      version: "0.1.0",
      type: "module",
      apiVersion: 1,
      runtime: { kind: "javascript", entry: "dist/extension.mjs" },
      contributes: {
        agents: [{ id: "multi", label: "Multi", executableCandidates: ["multi"] }],
        models: [
          {
            id: "multi-model",
            label: "Multi Model",
            provider: "multi",
            remoteId: "multi-model",
            agents: ["multi"],
          },
        ],
        channels: [{ id: "multi" }],
      },
      permissions: { process: ["multi"] },
    },
    multi.describe(),
  ),
  true,
);
assert.equal(multi.prepareAgent("multi", {}).executableCandidates[0], "multi");
assert.equal(multi.prepareModelProvider("multi", {}).provider, "multi");
assert.deepEqual(multi.setupChannel("multi", {}), {});

process.stdout.write(
  "extension_contract_smoke=ok bundled_agents=codex third_party_agents=sample providers=deepseek,ollama onboarding=codex,deepseek,ollama third_party_channels=channel dynamic_model=deepseek-v4-special computer_use=crd toolchains=codex,codex-acp,sample,channel-cli file_editors=office message_blocks=echarts,excalidraw\n",
);
