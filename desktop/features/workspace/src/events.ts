const isNative =
  typeof window !== "undefined" &&
  typeof (globalThis as typeof globalThis & { tuffite?: { invoke?: unknown } }).tuffite?.invoke ===
    "function";
import type {
  AgentOutputEvent,
  BrowserUseRequest,
  HumanHandoffRequest,
  OfficeUseRequest,
  OllamaModelChangedEvent,
  TerminalOutputEvent,
  ToolchainChangedEvent,
} from "./contract";
type ChannelEvent = Event & {
  readonly detail: Readonly<{ channel: string; data: Uint8Array }>;
};
type TuffiteBridge = {
  addEventListener(type: "channel", listener: (event: ChannelEvent) => void): void;
  removeEventListener(type: "channel", listener: (event: ChannelEvent) => void): void;
};

function observeChannel(
  bridge: TuffiteBridge,
  channel: string,
  listener: (payload: Uint8Array) => void,
): () => void {
  const handle = (event: ChannelEvent) => {
    if (event.detail.channel === channel) listener(event.detail.data);
  };
  bridge.addEventListener("channel", handle);
  return () => bridge.removeEventListener("channel", handle);
}

export function observeWorkspace(listener: () => void): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: TuffiteBridge }).tuffite;
  if (!isNative || !bridge) return () => undefined;
  return observeChannel(bridge, "ovule:workspace-changed", () => listener());
}

export function observeAgentOutput(listener: (event: AgentOutputEvent) => void): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: TuffiteBridge }).tuffite;
  if (!isNative || !bridge) return () => undefined;
  const decoder = new TextDecoder();
  return observeChannel(bridge, "ovule:agent-output", (payload) => {
    try {
      const value = JSON.parse(decoder.decode(payload)) as AgentOutputEvent;
      if (
        typeof value.attemptId === "string" &&
        Number.isSafeInteger(value.sequence) &&
        typeof value.delta === "string"
      )
        listener(value);
    } catch {
      // A malformed optional event is ignored; the final persisted snapshot is authoritative.
    }
  });
}

export function observeTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: TuffiteBridge }).tuffite;
  if (!isNative || !bridge) return () => undefined;
  const decoder = new TextDecoder();
  return observeChannel(bridge, "ovule:terminal-output", (payload) => {
    try {
      const value = JSON.parse(decoder.decode(payload)) as TerminalOutputEvent;
      if (
        typeof value.runId === "string" &&
        (value.ownerId === undefined || typeof value.ownerId === "string") &&
        Number.isSafeInteger(value.sequence) &&
        (value.stream === "stdout" || value.stream === "stderr") &&
        typeof value.delta === "string"
      ) {
        listener(value);
      }
    } catch {
      // The final persisted Terminal snapshot remains authoritative.
    }
  });
}

export function observeToolchainChanged(
  listener: (event: ToolchainChangedEvent) => void,
): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: TuffiteBridge }).tuffite;
  if (!isNative || !bridge) return () => undefined;
  const decoder = new TextDecoder();
  return observeChannel(bridge, "ovule:toolchain-changed", (payload) => {
    try {
      const value = JSON.parse(decoder.decode(payload)) as ToolchainChangedEvent;
      if (
        typeof value.id === "string" &&
        ["installing", "succeeded", "failed"].includes(value.status) &&
        (value.error === undefined || typeof value.error === "string")
      )
        listener(value);
    } catch {
      // A later status query remains authoritative.
    }
  });
}

export function observeOllamaModelChanged(
  listener: (event: OllamaModelChangedEvent) => void,
): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: TuffiteBridge }).tuffite;
  if (!isNative || !bridge) return () => undefined;
  const decoder = new TextDecoder();
  return observeChannel(bridge, "ovule:ollama-model-changed", (payload) => {
    try {
      const value = JSON.parse(decoder.decode(payload)) as OllamaModelChangedEvent;
      if (
        typeof value.model === "string" &&
        typeof value.status === "string" &&
        typeof value.detail === "string"
      )
        listener(value);
    } catch {
      // A later status query remains authoritative.
    }
  });
}

export function requestBrowserUse(
  target?: string,
  placement?: "thread" | "workbench",
  navigation?: "allow" | "emit",
) {
  window.dispatchEvent(
    new CustomEvent<BrowserUseRequest>("ovule:browser-use", {
      detail: { target, placement, navigation },
    }),
  );
}

export function observeBrowserUse(listener: (request: BrowserUseRequest) => void): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: TuffiteBridge }).tuffite;
  const decoder = new TextDecoder();
  const emit = (request: BrowserUseRequest) => {
    if (request.target && /^ovule:/i.test(request.target)) return;
    if (request.placement && !["thread", "workbench"].includes(request.placement)) return;
    listener(request);
  };
  const handleNativePayload = (payload: Uint8Array) => {
    try {
      const value = JSON.parse(decoder.decode(payload)) as BrowserUseRequest;
      if (
        (value.target === undefined || typeof value.target === "string") &&
        (value.placement === undefined || ["thread", "workbench"].includes(value.placement))
      )
        emit(value);
    } catch {
      /* Persisted state remains authoritative. */
    }
  };
  const domHandler = (event: Event) => {
    const detail = (event as CustomEvent<BrowserUseRequest>).detail ?? {};
    emit(detail);
  };
  const removeNative = bridge
    ? observeChannel(bridge, "ovule:browser-use", handleNativePayload)
    : () => undefined;
  window.addEventListener("ovule:browser-use", domHandler);
  return () => {
    removeNative();
    window.removeEventListener("ovule:browser-use", domHandler);
  };
}

export function requestHumanHandoff(request: HumanHandoffRequest) {
  window.dispatchEvent(
    new CustomEvent<HumanHandoffRequest>("ovule:human-handoff", {
      detail: request,
    }),
  );
}

export function observeHumanHandoff(listener: (request: HumanHandoffRequest) => void): () => void {
  const handle = (event: Event) => {
    const value = (event as CustomEvent<HumanHandoffRequest>).detail;
    if (value?.id && value.title && value.instructions) listener(value);
  };
  window.addEventListener("ovule:human-handoff", handle);
  return () => window.removeEventListener("ovule:human-handoff", handle);
}

export function requestOfficeUse(target: string) {
  window.dispatchEvent(
    new CustomEvent<OfficeUseRequest>("ovule:office-use", {
      detail: { target },
    }),
  );
}

export function observeOfficeUse(listener: (request: OfficeUseRequest) => void): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: TuffiteBridge }).tuffite;
  const decoder = new TextDecoder();
  const accept = (value: unknown) => {
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { target?: unknown }).target === "string" &&
      (value as { target: string }).target
    ) {
      listener(value as OfficeUseRequest);
    }
  };
  const removeNative = bridge
    ? observeChannel(bridge, "ovule:office-use", (payload) => {
        try {
          accept(JSON.parse(decoder.decode(payload)));
        } catch {
          /* Invalid optional events are ignored. */
        }
      })
    : () => undefined;
  const domHandler = (event: Event) => accept((event as CustomEvent<OfficeUseRequest>).detail);
  window.addEventListener("ovule:office-use", domHandler);
  return () => {
    removeNative();
    window.removeEventListener("ovule:office-use", domHandler);
  };
}
