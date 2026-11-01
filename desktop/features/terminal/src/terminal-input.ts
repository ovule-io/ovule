export type TerminalDraft = { command: string; cursor: number };

export type TerminalInputResult =
  | { kind: "draft"; draft: TerminalDraft; resetHistory?: true }
  | { kind: "history"; direction: -1 | 1 }
  | { kind: "clear" }
  | { kind: "ignored" };

export function reduceTerminalInput(draft: TerminalDraft, data: string): TerminalInputResult {
  const cursor = Math.min(draft.command.length, Math.max(0, draft.cursor));
  if (data === "\u000c") return { kind: "clear" };
  if (data === "\u0001" || data === "\x1b[H" || data === "\x1b[1~")
    return { kind: "draft", draft: { command: draft.command, cursor: 0 } };
  if (data === "\u0005" || data === "\x1b[F" || data === "\x1b[4~")
    return {
      kind: "draft",
      draft: { command: draft.command, cursor: draft.command.length },
    };
  if (data === "\x1b[A") return { kind: "history", direction: -1 };
  if (data === "\x1b[B") return { kind: "history", direction: 1 };
  if (data === "\x1b[D")
    return {
      kind: "draft",
      draft: { command: draft.command, cursor: Math.max(0, cursor - 1) },
    };
  if (data === "\x1b[C")
    return {
      kind: "draft",
      draft: {
        command: draft.command,
        cursor: Math.min(draft.command.length, cursor + 1),
      },
    };
  if (data === "\u007f" || data === "\b") {
    if (cursor === 0) return { kind: "ignored" };
    return {
      kind: "draft",
      draft: {
        command: draft.command.slice(0, cursor - 1) + draft.command.slice(cursor),
        cursor: cursor - 1,
      },
    };
  }
  if (data === "\x1b[3~") {
    if (cursor >= draft.command.length) return { kind: "ignored" };
    return {
      kind: "draft",
      draft: {
        command: draft.command.slice(0, cursor) + draft.command.slice(cursor + 1),
        cursor,
      },
    };
  }
  if (/^[\x00-\x1f\x7f]|^\x1b/.test(data)) return { kind: "ignored" };
  const inserted = data.replace(/[\r\n]+/g, " ");
  return {
    kind: "draft",
    resetHistory: true,
    draft: {
      command: draft.command.slice(0, cursor) + inserted + draft.command.slice(cursor),
      cursor: cursor + inserted.length,
    },
  };
}
