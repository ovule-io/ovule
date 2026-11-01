import { describe, expect, test } from "bun:test";
import { nextRemoteHostStatus } from "./remote-host-status";

describe("Remote Host reachability", () => {
  test("does not report Offline before the first three failed handshakes", () => {
    const first = nextRemoteHostStatus(undefined, false, "relay discovery pending");
    const second = nextRemoteHostStatus(first, false, "relay discovery pending");
    const third = nextRemoteHostStatus(second, false, "host unreachable");

    expect(first.phase).toBe("checking");
    expect(second.phase).toBe("checking");
    expect(third.phase).toBe("offline");
  });

  test("keeps a reachable Host in Reconnecting during transient failures", () => {
    const online = nextRemoteHostStatus(undefined, true, "connected", ["desktop.control"]);
    const reconnecting = nextRemoteHostStatus(online, false, "relay path changed");
    const recovered = nextRemoteHostStatus(reconnecting, true, "connected");

    expect(reconnecting.phase).toBe("reconnecting");
    expect(reconnecting.capabilities).toEqual(["desktop.control"]);
    expect(recovered).toEqual({
      phase: "online",
      detail: "connected",
      failures: 0,
      capabilities: [],
    });
  });
});
