import { describe, expect, test } from "bun:test";
import { IceDiagnostics, hasTurnServer, turnServerLabel } from "./ice";

describe("Remote Control ICE diagnostics", () => {
  test("does not treat STUN as a relay", () => {
    expect(hasTurnServer([{ urls: ["stun:one.example.com", "stun:two.example.com"] }])).toBe(false);
  });

  test("explains when direct candidates require TURN", () => {
    const diagnostics = new IceDiagnostics();
    diagnostics.setServers([{ urls: ["stun:one.example.com", "stun:two.example.com"] }]);
    diagnostics.recordCandidate("client", "candidate:1 1 udp 1 203.0.113.1 5000 typ srflx");
    diagnostics.recordCandidate("host", "candidate:2 1 udp 1 198.51.100.1 5001 typ srflx");
    expect(diagnostics.failureMessage()).toContain("requires a TURN relay");
  });

  test("distinguishes bad TURN configuration from a failed relay path", () => {
    const diagnostics = new IceDiagnostics();
    diagnostics.setServers([
      {
        urls: "turns:relay.example.com:443?transport=tcp",
        username: "u",
        credential: "p",
      },
    ]);
    expect(diagnostics.failureMessage()).toContain("Host TURN policy produced no relay candidate");
    diagnostics.recordCandidate(
      "client",
      "candidate:3 1 tcp 1 192.0.2.1 443 typ relay tcptype passive",
    );
    expect(diagnostics.failureMessage()).toContain("relay candidates were gathered");
  });

  test("does not misdiagnose first-frame failures after ICE connected", () => {
    const diagnostics = new IceDiagnostics();
    expect(diagnostics.failureMessage("first frame timed out", "connected")).toContain(
      "capture and encoder",
    );
  });

  test("does not prescribe TURN before Host startup and signaling completed", () => {
    const diagnostics = new IceDiagnostics();
    expect(diagnostics.failureMessage("handshake timed out", "new", false)).toContain(
      "did not provide an ICE configuration",
    );
    diagnostics.setServers([{ urls: "stun:one.example.com" }]);
    expect(diagnostics.failureMessage("handshake timed out", "new", false)).toContain(
      "no remote SDP was applied",
    );
    expect(diagnostics.failureMessage("handshake timed out", "connecting", true)).toContain(
      "Host provided no TURN relay",
    );
  });
});

test("reports provider failure after direct fallback without mislabeling successful ICE", () => {
  const diagnostics = new IceDiagnostics();
  diagnostics.setServers([{ urls: "stun:stun.cloudflare.com:3478" }]);
  diagnostics.setProviderWarning("Connection service rejected the credentials");
  expect(diagnostics.failureMessage("failed", "failed", true)).toContain(
    "relay service unavailable",
  );
  expect(diagnostics.failureMessage("first frame timed out", "connected", true)).toContain(
    "capture and encoder",
  );
});

test("TURN labels do not disclose URL credentials or query parameters", () => {
  expect(turnServerLabel("turn:turn.cloudflare.com:3478?transport=udp")).toBe(
    "Cloudflare (turn.cloudflare.com)",
  );
  expect(turnServerLabel("turn:username:secret@example.com")).toBeUndefined();
  expect(turnServerLabel("turn:example.com.evil.invalid?token=secret")).toBe(
    "example.com.evil.invalid",
  );
  expect(turnServerLabel("stun:example.com")).toBeUndefined();
});
