import { describe, expect, test } from "bun:test";
import { createWorkspacePairingLink, parseWorkspacePairingLink } from "./pairing-link";

describe("Ovule Workspace Links", () => {
  const value = {
    endpointAddrJson: JSON.stringify({
      id: "host-public-key",
      addrs: ["relay:https://relay.example"],
    }),
    endpointId: "host-public-key",
    shareId: "share-123",
    name: "Studio PC",
    alias: "project",
  };
  test("round-trips public routing metadata", () => {
    expect(parseWorkspacePairingLink(createWorkspacePairingLink(value))).toEqual(value);
  });
  test("never serializes credentials", () => {
    const link = createWorkspacePairingLink(value);
    expect(new URL(link).searchParams.has("protocol")).toBe(false);
    expect(link).not.toMatch(/secret|password|private_key|token/i);
  });
  test("routing invitations do not decide feature compatibility", () => {
    const link = new URL(createWorkspacePairingLink(value));
    link.searchParams.set("protocol", "99");
    expect(parseWorkspacePairingLink(link.href)).toEqual(value);
  });
  test("rejects links with missing stable fields", () => {
    expect(() => parseWorkspacePairingLink("ovule://app/hosts/link?address=e30")).toThrow(
      "host identity",
    );
  });
  test("rejects a mismatched host identity", () => {
    const link = createWorkspacePairingLink(value).replace(
      "endpoint=host-public-key",
      "endpoint=other",
    );
    expect(() => parseWorkspacePairingLink(link)).toThrow("does not match");
  });
});
