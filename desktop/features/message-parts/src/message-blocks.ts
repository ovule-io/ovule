import type { MessagePartView } from "@ovule/shell-api";

/** Recover control envelopes retained in older assistant messages. Only registered
 * extension kinds are eligible; malformed or incomplete content stays readable. */
export function expandMessageBlocks(
  parts: MessagePartView[],
  hasRenderer: (kind: string) => boolean,
): MessagePartView[] {
  const existing = new Set(parts.filter((part) => part.kind !== "markdown").map((part) => part.id));
  return parts.flatMap((part) => {
    if (part.kind !== "markdown" || !part.text) return [part];
    const result: MessagePartView[] = [];
    let cursor = 0;
    // Consume other fenced code blocks too, so examples containing envelopes stay code.
    const fences =
      /^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*(?:\r?\n|$)/gm;
    for (const match of part.text.matchAll(fences)) {
      if (match[2].trim() !== "ovule-block" || match[3].length > 256 * 1024) continue;
      let block;
      try {
        block = JSON.parse(match[3]);
      } catch {
        continue;
      }
      if (
        !block ||
        typeof block.id !== "string" ||
        !/^[a-zA-Z0-9._-]{1,128}$/.test(block.id) ||
        typeof block.kind !== "string" ||
        ["markdown", "thinking", "image", "file", "link"].includes(block.kind) ||
        !hasRenderer(block.kind) ||
        !Object.hasOwn(block, "data")
      )
        continue;
      const text = part.text.slice(cursor, match.index);
      if (text.trim()) result.push({ ...part, id: `${part.id}:text:${cursor}`, text });
      const persisted = parts.some(
        (item) => item.kind === block.kind && item.id.endsWith(`-extension-${block.id}`),
      );
      if (!existing.has(block.id) && !persisted) {
        result.push({
          id: `${part.id}:block:${block.id}`,
          kind: block.kind,
          dataJson: JSON.stringify(block.data),
        });
        existing.add(block.id);
      }
      cursor = match.index! + match[0].length;
    }
    if (!cursor) return [part];
    const text = part.text.slice(cursor);
    if (text.trim()) result.push({ ...part, id: `${part.id}:text:${cursor}`, text });
    return result;
  });
}
