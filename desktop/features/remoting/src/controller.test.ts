import { afterEach, expect, test } from "bun:test";
import { SessionController } from "./controller";
import type { ControlApi, ControlUpdate } from "./model";
import type { RemoteControlService } from "./remoting";

const originalPeer = globalThis.RTCPeerConnection;
const originalRaf = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
const originalReceiver = globalThis.RTCRtpReceiver;
const originalDocument = globalThis.document;
class Channel extends EventTarget {
  binaryType = "arraybuffer";
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send() {}
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
}
class Peer {
  connectionState = "new";
  createDataChannel() {
    return new Channel();
  }
  close() {
    this.connectionState = "closed";
  }
  async getStats() {
    return new Map();
  }
  setConfiguration() {}
}
afterEach(() => {
  globalThis.RTCPeerConnection = originalPeer;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancel;
  globalThis.RTCRtpReceiver = originalReceiver;
  if (originalDocument === undefined) Reflect.deleteProperty(globalThis, "document");
  else globalThis.document = originalDocument;
});

test("ICE arriving before SDP is buffered and applied after the description", async () => {
  const order: string[] = [];
  class SignalingPeer extends Peer {
    remoteDescription: RTCSessionDescriptionInit | null = null;
    setConfiguration(configuration: RTCConfiguration) {
      expect(configuration.bundlePolicy).toBe("max-bundle");
      expect(configuration.iceTransportPolicy).toBe("relay");
      order.push("ice-config");
    }
    async setRemoteDescription(description: RTCSessionDescriptionInit) {
      this.remoteDescription = description;
      order.push("description");
    }
    async addIceCandidate() {
      if (!this.remoteDescription) throw new Error("ICE before SDP");
      order.push("ice");
    }
    async createAnswer() {
      return { type: "answer", sdp: "answer" };
    }
    async setLocalDescription() {
      order.push("local");
    }
    getTransceivers() {
      return [];
    }
  }
  globalThis.RTCPeerConnection = SignalingPeer as unknown as typeof RTCPeerConnection;
  globalThis.RTCRtpReceiver = {
    getCapabilities: () => ({ codecs: [] }),
  } as unknown as typeof RTCRtpReceiver;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = { hidden: false } as Document;
  let answered!: () => void;
  const answer = new Promise<void>((resolve) => {
    answered = resolve;
  });
  const api = {
    start: async () => 7n,
    snapshot: async () => ({
      sessionId: "7",
      state: "connecting",
      route: "direct",
      iceServers: [{ urls: ["turn:turn.example.com:3478"] }],
      signals: [
        {
          sequence: 1n,
          candidates: [{ mid: "0", mLineIndex: 0, candidate: "candidate" }],
        },
        {
          sequence: 2n,
          description: { type: "offer", sdp: "offer" },
          candidates: [],
        },
      ],
    }),
    signal: async () => {
      order.push("answer");
      answered();
      return true;
    },
    stop: async () => true,
  } as unknown as ControlApi;
  const controller = new SessionController(
    { api: async () => api, observe: () => () => {} },
    "host",
    { iceTransportPolicy: "relay", targetFramerate: 60, maxBitrateKbps: 12000 },
    { srcObject: null } as HTMLVideoElement,
    () => {},
  );
  try {
    controller.start();
    await answer;
    expect(order).toEqual(["ice-config", "description", "ice", "local", "answer"]);
  } finally {
    controller.close();
  }
});
test("closing while Start is in flight stops its eventual handle and never reconnects", async () => {
  globalThis.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  let finish!: (id: bigint) => void;
  let started!: () => void;
  const starting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stopped: bigint[] = [];
  let listener: ((update: ControlUpdate) => void) | undefined;
  const api = {
    start: () => {
      started();
      return new Promise<bigint>((resolve) => {
        finish = resolve;
      });
    },
    stop: async (id: bigint) => {
      stopped.push(id);
      return true;
    },
  } as unknown as ControlApi;
  const service: RemoteControlService = {
    api: async () => api,
    observe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  const states: string[] = [];
  const controller = new SessionController(
    service,
    "host",
    { targetFramerate: 60, maxBitrateKbps: 12000 },
    { srcObject: null } as HTMLVideoElement,
    (view) => states.push(view.status),
  );
  controller.start();
  await starting;
  controller.close();
  finish(91n);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stopped).toEqual([91n]);
  expect(listener).toBeUndefined();
  expect(states).toEqual(["connecting"]);
});

test("TURN-only mode fails explicitly when the Host supplies STUN without TURN", async () => {
  globalThis.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
  globalThis.document = { hidden: false } as Document;
  let report!: (value: string) => void;
  const failure = new Promise<string>((resolve) => {
    report = resolve;
  });
  const api = {
    start: async () => 9n,
    snapshot: async () => ({
      sessionId: "9",
      state: "connecting",
      signals: [],
      iceServers: [{ urls: ["stun:example.com"] }],
    }),
    stop: async () => true,
  } as unknown as ControlApi;
  const service = {
    api: async () => api,
    observe: () => () => {},
  } as unknown as RemoteControlService;
  const controller = new SessionController(
    service,
    "host",
    { iceTransportPolicy: "relay", targetFramerate: 60, maxBitrateKbps: 12000 },
    { srcObject: null } as HTMLVideoElement,
    (view) => {
      if (view.error) report(view.error);
    },
  );
  controller.start();
  try {
    expect(await failure).toContain("TURN-only mode requires");
  } finally {
    controller.close();
  }
});
