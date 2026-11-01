import { describe, expect, test } from "bun:test";

import {
  decodeLinkRemoteControlSession,
  decodeSpiceSession,
  encodeLinkRemoteControlSession,
  encodeSpiceSession,
  spiceWebsocketUrlError,
} from "./session-links-codec";

describe("SPICE session model", () => {
  test("round-trips a secure remote WebSocket session", () => {
    const request = {
      endpointId: "endpoint-1",
      displayName: "Build Host",
      websocketUrl: "wss://desktop.example.com/spice",
    };
    expect(decodeSpiceSession(encodeSpiceSession(request))).toEqual(request);
  });

  test("allows plaintext WebSocket only for loopback validation", () => {
    expect(spiceWebsocketUrlError("ws://127.0.0.1:5959")).toBeUndefined();
    expect(spiceWebsocketUrlError("ws://remote.example.com:5959")).toBe(
      "spice.secureWebsocketRequired",
    );
  });

  test("rejects credentials and secret-bearing URL state", () => {
    expect(spiceWebsocketUrlError("wss://user:pass@example.com/spice")).toBe(
      "spice.invalidWebsocketUrl",
    );
    expect(spiceWebsocketUrlError("wss://example.com/spice?ticket=secret")).toBe(
      "spice.invalidWebsocketUrl",
    );
  });

  test("round-trips a credential-free Ovule Link Remote Control session", () => {
    const request = { endpointId: "remote-1", displayName: "Studio Host" };
    expect(decodeLinkRemoteControlSession(encodeLinkRemoteControlSession(request))).toEqual(
      request,
    );
  });
});
