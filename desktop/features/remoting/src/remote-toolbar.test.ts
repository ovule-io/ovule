import { expect, test } from "bun:test";
import { handleRemoteToolbarCommand, type RemoteToolbarHandlers } from "./remote-toolbar";

test("remote toolbar dispatches controls and preserves clipboard Unicode, colons and newlines", () => {
  const calls: unknown[] = [];
  const handlers: RemoteToolbarHandlers = {
    reconnect: () => calls.push("reconnect"),
    clipboard: (text) => calls.push(["clipboard", text]),
    syncClipboard: () => calls.push("sync"),
    ctrlAltDelete: () => calls.push("shortcut"),
    mode: (value) => calls.push(["mode", value]),
    quality: (value) => calls.push(["quality", value]),
  };
  for (const command of [
    "remote.reconnect",
    "remote.ctrlAltDelete",
    "remote.mode:relay",
    "remote.quality:detail",
    "remote.clipboard:中文 https://example.com:443\nnext",
    "remote.syncClipboard",
  ])
    handleRemoteToolbarCommand(command, handlers);
  expect(calls).toEqual([
    "reconnect",
    "shortcut",
    ["mode", "relay"],
    ["quality", "detail"],
    ["clipboard", "中文 https://example.com:443\nnext"],
    "sync",
  ]);
  calls.length = 0;
  for (const command of ["remote.mode:invalid", "remote.quality:invalid", "browser.reload"])
    handleRemoteToolbarCommand(command, handlers);
  expect(calls).toEqual([]);
});
