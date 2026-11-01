import { expect, test } from "bun:test";
import { connectionErrorKey } from "./connection-error";
test("distinguishes startup, capture and relay failures", () => {
  expect(connectionErrorKey("WebRTC ICE failed; requires a TURN relay")).toBe(
    "spice.connectionRelaySetup",
  );
  expect(connectionErrorKey("ICE connected, so verify Host capture")).toBe(
    "spice.connectionCaptureFailed",
  );
  expect(connectionErrorKey("no remote SDP was applied")).toBe("spice.connectionHostStartup");
  expect(connectionErrorKey("relay service unavailable: rejected credentials")).toBe(
    "spice.connectionRelayUnavailable",
  );
});
