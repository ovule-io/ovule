import assert from "node:assert/strict";
import { test } from "node:test";
import { relayOptions, selectTurnTransport } from "./relay-options.mjs";

test("real relay runs cannot silently use a fake fixture or direct mode", () => {
  assert.throws(() => relayOptions({ "cloudflare-setup": true }), /require-relay/);
  const valid = { "require-relay": true, "connection-only": true, "cloudflare-setup": true };
  assert.equal(relayOptions(valid).setup, true);
  assert.throws(() => relayOptions({ ...valid, "host-owned-turn-fixture": true }), /fake TURN/);
  assert.throws(() => relayOptions({ ...valid, "cloudflare-credentials": "encrypted" }), /Choose/);
  assert.throws(() => relayOptions({ ...valid, "turn-transport": "bogus" }), /must be/);
});

test("transport isolation preserves issued credentials and excludes STUN/direct paths", () => {
  const server = {
    urls: [
      "stun:stun.example:3478",
      "turn:turn.example:3478?transport=udp",
      "turn:turn.example:3478?transport=tcp",
      "turns:turn.example:5349?transport=tcp",
      "turns:turn.example:443?transport=tcp",
    ],
    username: "user",
    credential: "secret",
  };
  for (const [transport, index] of [
    ["udp", 1],
    ["tcp", 2],
    ["tls", 4],
  ]) {
    assert.deepEqual(selectTurnTransport([server], transport), [
      { ...server, urls: [server.urls[index]] },
    ]);
  }
  assert.equal(server.urls.length, 5);
  assert.deepEqual(selectTurnTransport([{ urls: ["stun:example"] }], "tls"), []);
});
