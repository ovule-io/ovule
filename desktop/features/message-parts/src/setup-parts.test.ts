import { expect, test } from "bun:test";
import type { MessagePartView } from "@ovule/shell-api";
import { uniqueSetupParts } from "./setup-parts";
const part = (id: string, data: object) =>
  ({
    id,
    kind: "channel-setup",
    dataJson: JSON.stringify(data),
  }) as MessagePartView;
test("host configuration is authoritative when a model also emits an empty or conflicting card", () => {
  const host = part("node-extension-setup-status", {
    connections: [{ connectionId: "default", connected: true }],
  });
  const generated = part("generated", {});
  const conflicting = part("conflicting", {
    connections: [{ connectionId: "default", connected: false }],
  });
  const markdown = {
    id: "text",
    kind: "markdown",
    text: "Conclusion",
  } as MessagePartView;
  expect(uniqueSetupParts([host, markdown, generated, conflicting])).toEqual([host, markdown]);
});
test("model-only setup retains the populated connection card and other blocks", () => {
  const empty = part("empty", {});
  const populated = part("ready", { connections: [{ connectionId: "bot" }] });
  const other = { id: "other", kind: "interactive-ui" } as MessagePartView;
  expect(uniqueSetupParts([empty, populated, other])).toEqual([populated, other]);
});
