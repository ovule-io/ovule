/** Printable input belongs to the local IME; physical events carry shortcuts/navigation. */
export function isTextKey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "getModifierState">,
): boolean {
  const shortcut =
    event.metaKey || ((event.ctrlKey || event.altKey) && !event.getModifierState("AltGraph"));
  return (
    !shortcut && (event.key.length === 1 || event.key === "Dead" || event.key === "Unidentified")
  );
}

/** Browsers differ on whether final input is delivered after compositionend. */
export class TextCommitter {
  private committed?: string;
  newKey(): void {
    this.committed = undefined;
  }
  compositionEnd(text: string): string | undefined {
    this.committed = text;
    return text || undefined;
  }
  input(text: string): string | undefined {
    const duplicate = text === this.committed;
    this.committed = undefined;
    return duplicate ? undefined : text || undefined;
  }
}
