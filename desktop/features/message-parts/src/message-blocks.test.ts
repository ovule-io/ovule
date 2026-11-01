import { expect, test } from "bun:test";
import type { MessagePartView } from "@ovule/shell-api";
import { expandMessageBlocks } from "./message-blocks";

const data = {
  title: "Configuration",
  html: "<button>Apply</button><script>const fence = '```';</script>",
};
const envelope = `\`\`\`ovule-block\n${JSON.stringify({ id: "config", kind: "interactive-ui", data })}\n\`\`\``;
const markdown = (text: string): MessagePartView => ({ id: "answer", kind: "markdown", text });
const registered = (kind: string) => kind === "interactive-ui";

test("recovers interactive blocks in old messages in place, preserving surrounding Markdown", () => {
  const result = expandMessageBlocks([markdown(`Before\n\n${envelope}\n\nAfter`)], registered);
  expect(result.map((part) => part.kind)).toEqual(["markdown", "interactive-ui", "markdown"]);
  expect(result[0].text?.trim()).toBe("Before");
  expect(JSON.parse(result[1].dataJson!)).toEqual(data);
  expect(result[2].text?.trim()).toBe("After");
});

test("preserves incomplete, invalid, unregistered, and nested example fences", () => {
  for (const text of [
    envelope.slice(0, -3),
    envelope.replace('"config"', '"bad id"'),
    envelope.replace('"interactive-ui"', '"unknown"'),
    envelope.replace('"data":', '"missing":'),
    "```ovule-block\ninvalid JSON\n```",
    `\`\`\`\`markdown\n${envelope}\n\`\`\`\``,
  ]) {
    const part = markdown(text);
    expect(expandMessageBlocks([part], registered)).toEqual([part]);
  }
});

test("does not duplicate a block already persisted by the host or repeated in Markdown", () => {
  const persisted = {
    id: "response-extension-config",
    kind: "interactive-ui",
    dataJson: JSON.stringify(data),
  };
  expect(expandMessageBlocks([markdown(envelope), persisted], registered)).toEqual([persisted]);
  const result = expandMessageBlocks([markdown(`${envelope}\n${envelope}`)], registered);
  expect(result).toHaveLength(1);
  expect(result[0].kind).toBe("interactive-ui");
});
