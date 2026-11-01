const MAX_EXTENSION_ID_BYTES = 128;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_EVENTS_PER_RESULT = 128;

export function defineAgent(adapter) {
  return validateAdapter("agent", adapter, ["prepare", "onStdout", "onStderr", "onExit"]);
}

export function defineChannel(adapter) {
  return validateAdapter("channel", adapter, [
    "setup",
    "connect",
    "onTransportEvent",
    "deliver",
    "onTimer",
    "shutdown",
  ]);
}

export function defineModelProvider(adapter) {
  return validateAdapter("model-provider", adapter, ["prepare"]);
}

export function defineExtension(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new TypeError("extension definition must be an object");
  }
  const allowed = new Set([
    "id",
    "apiVersion",
    "capabilities",
    "agents",
    "modelProviders",
    "channels",
  ]);
  if (Object.keys(definition).some((key) => !allowed.has(key))) {
    throw new TypeError("extension definition contains an unknown field");
  }
  if (
    !validId(definition.id) ||
    definition.apiVersion !== 1 ||
    !uniqueStrings(definition.capabilities, 1, 32) ||
    definition.capabilities.some((capability) => !validId(capability))
  ) {
    throw new TypeError("invalid extension descriptor");
  }
  const agents = validateAdapterMap("agent", definition.agents, [
    "prepare",
    "onStdout",
    "onStderr",
    "onExit",
  ]);
  const modelProviders = validateAdapterMap("model-provider", definition.modelProviders, [
    "prepare",
  ]);
  const channels = validateAdapterMap("channel", definition.channels, [
    "setup",
    "connect",
    "onTransportEvent",
    "deliver",
    "onTimer",
    "shutdown",
  ]);
  if (
    !Object.keys(agents).length &&
    !Object.keys(modelProviders).length &&
    !Object.keys(channels).length
  ) {
    throw new TypeError("executable extension must register at least one adapter");
  }
  const adapter = (kind, registry, id) => {
    const value = registry[id];
    if (!value) throw new TypeError(`unknown ${kind} contribution: ${id}`);
    return value;
  };
  return Object.freeze({
    describe: () => ({
      id: definition.id,
      apiVersion: definition.apiVersion,
      capabilities: [...definition.capabilities],
      handlers: {
        agents: Object.keys(agents),
        modelProviders: Object.keys(modelProviders),
        channels: Object.keys(channels),
      },
    }),
    prepareAgent: (id, input) => adapter("Agent", agents, id).prepare(input),
    onAgentStdout: (id, state, frame) => adapter("Agent", agents, id).onStdout(state, frame),
    onAgentStderr: (id, state, frame) => adapter("Agent", agents, id).onStderr(state, frame),
    onAgentExit: (id, state, exit) => adapter("Agent", agents, id).onExit(state, exit),
    prepareModelProvider: (id, input) =>
      adapter("Model Provider", modelProviders, id).prepare(input),
    setupChannel: (id, input) => adapter("Channel", channels, id).setup(input),
    connectChannel: (id, input) => adapter("Channel", channels, id).connect(input),
    onChannelTransportEvent: (id, state, event) =>
      adapter("Channel", channels, id).onTransportEvent(state, event),
    deliverChannel: (id, state, request) =>
      adapter("Channel", channels, id).deliver(state, request),
    onChannelTimer: (id, state, timer) => adapter("Channel", channels, id).onTimer(state, timer),
    shutdownChannel: (id, state) => adapter("Channel", channels, id).shutdown(state),
  });
}

export function validateManifest(manifest, descriptor) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("extension manifest must be an object");
  }
  if (manifest.schemaVersion !== 1 || !validId(manifest.id) || !manifest.contributes) {
    throw new TypeError("extension manifest and descriptor do not match");
  }
  const isolatedEntry = manifest.ui?.entry;
  if (
    manifest.ui !== undefined &&
    (!manifest.ui ||
      Object.keys(manifest.ui).some((key) => key !== "entry") ||
      !safeAsset(isolatedEntry, ".js") ||
      !isolatedEntry.startsWith("dist/"))
  ) {
    throw new TypeError("extension isolated UI entry is invalid");
  }
  const uiModule = (value) =>
    (isolatedEntry !== undefined && value === isolatedEntry) ||
    (safeAsset(value, ".mjs") && value.startsWith("dist/web/"));
  const contributionKinds = ["agents", "channels", "skills", "models", "toolchains"];
  const contributions = contributionKinds.flatMap((kind) => {
    const values = manifest.contributes[kind] ?? [];
    if (!Array.isArray(values))
      throw new TypeError(`extension contributes.${kind} must be an array`);
    return values;
  });
  const capabilities = manifest.contributes.capabilities ?? [];
  const messageBlocks = manifest.contributes.messageBlocks ?? [];
  const slashCommands = manifest.contributes.slashCommands ?? [];
  const actions = manifest.contributes.actions ?? [];
  const computerUse = manifest.contributes.computerUse ?? [];
  const fileEditors = manifest.contributes.fileEditors ?? [];
  const onboarding = manifest.contributes.onboarding ?? [];
  if (
    !Array.isArray(capabilities) ||
    !Array.isArray(messageBlocks) ||
    !Array.isArray(slashCommands) ||
    !Array.isArray(actions) ||
    !Array.isArray(computerUse) ||
    !Array.isArray(fileEditors) ||
    !Array.isArray(onboarding) ||
    (!contributions.length &&
      !capabilities.length &&
      !messageBlocks.length &&
      !slashCommands.length &&
      !computerUse.length &&
      !fileEditors.length &&
      !onboarding.length) ||
    contributions.some((item) => !item || !validId(item.id)) ||
    contributionKinds.some((kind) => {
      const values = manifest.contributes[kind] ?? [];
      return new Set(values.map((item) => item.id)).size !== values.length;
    })
  ) {
    throw new TypeError("extension contributions are invalid");
  }
  if (
    computerUse.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        !nonEmpty(item.label) ||
        !validId(item.provider) ||
        !["native-crd", "mcp-stdio"].includes(item.backend) ||
        (item.backend === "native-crd" &&
          (item.toolchain !== undefined || (item.args?.length ?? 0) !== 0)) ||
        (item.backend === "mcp-stdio" && !validId(item.toolchain)) ||
        !stringList(item.args ?? [], 0, 64) ||
        !uniqueStrings(item.capabilities, 1, 32) ||
        item.capabilities.some((capability) => !validId(capability)) ||
        (item.agents !== undefined &&
          (!uniqueStrings(item.agents, 0, 16) || item.agents.some((agent) => !validId(agent)))),
    ) ||
    new Set(computerUse.map((item) => item.id)).size !== computerUse.length
  ) {
    throw new TypeError("extension Computer Use contributions are invalid");
  }
  if (
    fileEditors.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        !nonEmpty(item.label) ||
        !uniqueStrings(item.extensions, 1, 32) ||
        item.extensions.some((extension) => !/^[a-z0-9]+$/.test(extension)) ||
        !["read-only", "editable"].includes(item.mode) ||
        (item.threadPresentation !== undefined &&
          !["link", "card"].includes(item.threadPresentation)) ||
        typeof item.tag !== "string" ||
        !item.tag.includes("-") ||
        !uiModule(item.module) ||
        (item.style !== undefined &&
          (!safeAsset(item.style, ".css") || !item.style.startsWith("dist/web/"))),
    ) ||
    new Set(fileEditors.map((item) => item.id)).size !== fileEditors.length ||
    new Set(fileEditors.flatMap((item) => item.extensions)).size !==
      fileEditors.reduce((count, item) => count + item.extensions.length, 0)
  ) {
    throw new TypeError("extension File Editor contributions are invalid");
  }
  if (
    onboarding.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        !nonEmpty(item.label) ||
        !nonEmpty(item.description) ||
        !validId(item.icon) ||
        !Array.isArray(item.fields) ||
        !Array.isArray(item.actions) ||
        !item.actions.length ||
        !Array.isArray(item.links) ||
        !item.status,
    ) ||
    new Set(onboarding.map((item) => item.id)).size !== onboarding.length
  ) {
    throw new TypeError("extension Onboarding contributions are invalid");
  }
  const permissions = manifest.permissions ?? {};
  const processes = permissions.process ?? [];
  const agents = manifest.contributes.agents ?? [];
  const models = manifest.contributes.models ?? [];
  if (
    !Array.isArray(processes) ||
    agents.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        !nonEmpty(item.label) ||
        !uniqueStrings(item.executableCandidates, 1, 16) ||
        item.executableCandidates.some((candidate) => !processes.includes(candidate)) ||
        (item.toolchain !== undefined && !validId(item.toolchain)) ||
        (item.mcpConfig !== undefined && typeof item.mcpConfig !== "boolean") ||
        (item.requiredEnvironment !== undefined && !uniqueStrings(item.requiredEnvironment, 0, 32)),
    ) ||
    models.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        !nonEmpty(item.label) ||
        !validId(item.provider) ||
        !nonEmpty(item.remoteId) ||
        !uniqueStrings(item.agents, 1, 16) ||
        (item.recommended !== undefined && typeof item.recommended !== "boolean") ||
        (item.description !== undefined && typeof item.description !== "string"),
    )
  ) {
    throw new TypeError("extension Agent or Model contributions are invalid");
  }
  if (
    capabilities.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        typeof item.label !== "string" ||
        typeof item.description !== "string",
    ) ||
    new Set(capabilities.map((item) => item.id)).size !== capabilities.length
  ) {
    throw new TypeError("extension capabilities are invalid");
  }
  const capabilityIds = new Set(capabilities.map((item) => item.id));
  if (
    messageBlocks.some((item) => {
      if (
        !item ||
        !validId(item.kind) ||
        typeof item.agentInstructions !== "string" ||
        !item.agentInstructions.trim() ||
        item.example === undefined ||
        (item.capability !== undefined && !capabilityIds.has(item.capability))
      ) {
        return true;
      }
      if (item.ui !== undefined) {
        if (
          [item.tag, item.module, item.style, item.hostRenderer].some(
            (value) => value !== undefined,
          )
        )
          return true;
        const ui = item.ui;
        return (
          !ui ||
          !(
            (ui.type === "iframe" && Object.keys(ui).every((key) => key === "type")) ||
            (ui.type === "isolated" &&
              isolatedEntry !== undefined &&
              typeof ui.tag === "string" &&
              ui.tag.includes("-") &&
              Object.keys(ui).every((key) => key === "type" || key === "tag"))
          )
        );
      }
      const moduleRenderer =
        typeof item.tag === "string" &&
        item.tag.includes("-") &&
        uiModule(item.module) &&
        (item.style === undefined ||
          (safeAsset(item.style, ".css") && item.style.startsWith("dist/web/"))) &&
        item.hostRenderer === undefined;
      const hostRenderer =
        (item.hostRenderer === "human-handoff" ||
          (item.hostRenderer === "channel-setup" &&
            (manifest.contributes.channels ?? []).length > 0)) &&
        item.tag === undefined &&
        item.module === undefined &&
        item.style === undefined;
      return !moduleRenderer && !hostRenderer;
    }) ||
    new Set(messageBlocks.map((item) => item.kind)).size !== messageBlocks.length
  ) {
    throw new TypeError("extension Message Blocks are invalid");
  }
  const channelIds = new Set((manifest.contributes.channels ?? []).map((item) => item.id));
  const skillIds = new Set((manifest.contributes.skills ?? []).map((item) => item.id));
  const blockKinds = new Set(messageBlocks.map((item) => item.kind));
  if (
    (manifest.contributes.skills ?? []).some(
      (item) =>
        !item ||
        !validId(item.id) ||
        !safeAsset(item.path, ".md") ||
        !item.path.startsWith("skills/"),
    )
  ) {
    throw new TypeError("extension Skill contributions are invalid");
  }
  if (
    slashCommands.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        typeof item.label !== "string" ||
        !item.label.trim() ||
        typeof item.description !== "string" ||
        !item.description.trim() ||
        item.handler !== "channel.setup" ||
        !channelIds.has(item.target) ||
        !Array.isArray(item.skills) ||
        !item.skills.length ||
        item.skills.some((skill) => !skillIds.has(skill)) ||
        new Set(item.skills).size !== item.skills.length ||
        !safeAsset(item.workflow, ".md") ||
        !item.workflow.startsWith("workflows/") ||
        !blockKinds.has(item.statusBlock) ||
        !validWorkflowFallback(item.fallback),
    ) ||
    new Set(slashCommands.map((item) => item.id)).size !== slashCommands.length
  ) {
    throw new TypeError("extension slash commands are invalid");
  }
  if (
    actions.some(
      (item) =>
        !item ||
        !validId(item.id) ||
        !channelIds.has(item.target) ||
        !["channel.status", "channel.registration.start"].includes(item.handler) ||
        (item.reuseExisting !== undefined && typeof item.reuseExisting !== "boolean") ||
        (item.reuseExisting === true && item.handler !== "channel.registration.start"),
    ) ||
    new Set(actions.map((item) => item.id)).size !== actions.length
  ) {
    throw new TypeError("extension actions are invalid");
  }
  const runtime = manifest.runtime;
  if (
    runtime !== undefined &&
    (!runtime || typeof runtime !== "object" || Array.isArray(runtime))
  ) {
    throw new TypeError("extension runtime is invalid");
  }
  if (runtime?.kind === "javascript") {
    if (
      typeof runtime.entry !== "string" ||
      !runtime.entry.endsWith(".mjs") ||
      !/^[a-zA-Z0-9._/-]+$/.test(runtime.entry) ||
      runtime.entry.startsWith("/") ||
      runtime.entry.split("/").includes("..")
    ) {
      throw new TypeError("extension entry is unsafe");
    }
  } else if (runtime !== undefined && (runtime.kind !== "utility" || !validId(runtime.service))) {
    throw new TypeError("extension runtime is invalid");
  }
  if ((agents.length || models.length || channelIds.size) && runtime === undefined) {
    throw new TypeError("executable extension contributions require a Host runtime");
  }
  if (runtime === undefined) {
    if (descriptor !== undefined) {
      throw new TypeError("declarative extension must not expose a Host runtime descriptor");
    }
    return true;
  }
  if (
    !descriptor ||
    descriptor.id !== manifest.id ||
    descriptor.apiVersion !== manifest.apiVersion ||
    !uniqueStrings(descriptor.capabilities, 1, 32) ||
    !descriptor.handlers
  ) {
    throw new TypeError("extension manifest and descriptor do not match");
  }
  const handlers = descriptor.handlers;
  const agentIds = agents.map((agent) => agent.id);
  const providerIds = [...new Set(models.map((model) => model.provider))];
  const declaredChannelIds = [...channelIds];
  if (
    !sameStringSet(handlers.agents, agentIds) ||
    !sameStringSet(handlers.modelProviders, providerIds) ||
    !sameStringSet(handlers.channels, declaredChannelIds)
  ) {
    throw new TypeError("extension runtime handlers do not match its contributions");
  }
  return true;
}

export function decodeUtf8(frame) {
  if (typeof frame === "string") return frame;
  if (!(frame instanceof Uint8Array)) throw new TypeError("frame must be Uint8Array");
  let output = "";
  for (let index = 0; index < frame.length; ) {
    const first = frame[index++];
    let point;
    if (first <= 0x7f) {
      point = first;
    } else if (first >= 0xc2 && first <= 0xdf && index < frame.length) {
      const second = frame[index++];
      if ((second & 0xc0) !== 0x80) throw new TypeError("frame is not valid UTF-8");
      point = ((first & 0x1f) << 6) | (second & 0x3f);
    } else if (first >= 0xe0 && first <= 0xef && index + 1 < frame.length) {
      const second = frame[index++];
      const third = frame[index++];
      if (
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80 ||
        (first === 0xe0 && second < 0xa0) ||
        (first === 0xed && second >= 0xa0)
      ) {
        throw new TypeError("frame is not valid UTF-8");
      }
      point = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
    } else if (first >= 0xf0 && first <= 0xf4 && index + 2 < frame.length) {
      const second = frame[index++];
      const third = frame[index++];
      const fourth = frame[index++];
      if (
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80 ||
        (fourth & 0xc0) !== 0x80 ||
        (first === 0xf0 && second < 0x90) ||
        (first === 0xf4 && second >= 0x90)
      ) {
        throw new TypeError("frame is not valid UTF-8");
      }
      point =
        ((first & 7) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
    } else {
      throw new TypeError("frame is not valid UTF-8");
    }
    output += String.fromCodePoint(point);
  }
  return output;
}

export function parseJsonObject(frame) {
  const value = JSON.parse(decodeUtf8(frame));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("extension frame must contain a JSON object");
  }
  return value;
}

export function result(state, events = [], operations = []) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_RESULT) {
    throw new RangeError("extension result contains too many events");
  }
  if (!Array.isArray(operations) || operations.length > MAX_EVENTS_PER_RESULT) {
    throw new RangeError("extension result contains too many operations");
  }
  const encoded = JSON.stringify(state ?? null);
  if (utf8ByteLength(encoded) > MAX_STATE_BYTES) {
    throw new RangeError("extension state is too large");
  }
  return { state: state ?? null, events, operations };
}

export function messageBlock(id, kind, data) {
  if (!validId(id) || !validId(kind)) throw new TypeError("invalid Message Block identity");
  const event = {
    kind: "message.block",
    payload: { id, kind, data: data ?? null },
  };
  if (utf8ByteLength(JSON.stringify(event.payload)) > MAX_STATE_BYTES) {
    throw new RangeError("Message Block payload is too large");
  }
  return event;
}

function validateAdapterMap(kind, value, hooks) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${kind} adapters must be an object`);
  }
  const output = {};
  for (const [id, adapter] of Object.entries(value)) {
    if (!validId(id)) throw new TypeError(`invalid ${kind} contribution id`);
    output[id] = validateAdapter(kind, adapter, hooks);
  }
  return Object.freeze(output);
}

function validateAdapter(kind, adapter, hooks) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new TypeError(`${kind} adapter must be an object`);
  }
  if (hooks.some((hook) => typeof adapter[hook] !== "function")) {
    throw new TypeError(`${kind} adapter is missing required hooks`);
  }
  return Object.freeze(adapter);
}

function validId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    utf8ByteLength(value) <= MAX_EXTENSION_ID_BYTES &&
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)
  );
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validWorkflowFallback(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    nonEmpty(value.title) &&
    nonEmpty(value.intent) &&
    nonEmpty(value.response) &&
    Array.isArray(value.nodes) &&
    value.nodes.length >= 1 &&
    value.nodes.length <= 6 &&
    value.nodes.every(
      (node, index) =>
        node &&
        typeof node === "object" &&
        !Array.isArray(node) &&
        validId(node.id) &&
        ["task", "gate"].includes(node.kind) &&
        nonEmpty(node.title) &&
        uniqueStrings(node.dependsOn, 0, 6) &&
        node.dependsOn.every((dependency) =>
          value.nodes.slice(0, index).some((candidate) => candidate.id === dependency),
        ) &&
        (node.agent == null || validId(node.agent)) &&
        (node.host == null || validId(node.host)) &&
        (node.workspaces === undefined ||
          (uniqueStrings(node.workspaces, 0, 16) && node.workspaces.every(validId))),
    ) &&
    new Set(value.nodes.map((node) => node.id)).size === value.nodes.length
  );
}

function uniqueStrings(value, minimum, maximum) {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(nonEmpty) &&
    new Set(value).size === value.length
  );
}

function sameStringSet(left, right) {
  return (
    uniqueStrings(left, 0, 64) &&
    uniqueStrings(right, 0, 64) &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function stringList(value, minimum, maximum) {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(nonEmpty)
  );
}

function safeAsset(value, suffix) {
  return (
    typeof value === "string" &&
    value.endsWith(suffix) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
