import type { MessagePresentationRegistry } from "@ovule/conversation/messages/message-list";

function rewriteWorkspaceFileLinks(
  registry: MessagePresentationRegistry,
  markdown: string,
): string {
  return markdown.replace(
    /(?<!!)\[([^\]]+)]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g,
    (whole, label: string, rawTarget: string) => {
      const target = decodeMarkdownDestination(rawTarget);
      if (!target) return whole;
      if (/^https?:\/\//i.test(target)) return whole;
      if (/\.html?(?:[?#].*)?$/i.test(target)) {
        return `[${label}](#ovule-preview=${encodeURIComponent(target)})`;
      }
      if (fileEditorForTarget(registry, target)) {
        return fileEditorMarkdown(label, target);
      }
      return whole;
    },
  );
}

export function rewriteLocalFileReferences(
  registry: MessagePresentationRegistry,
  markdown: string,
): string {
  const linked = rewriteWorkspaceFileLinks(registry, markdown);
  const pattern =
    /(^|[\s(（\[])((?:[A-Za-z]:[\\/]|\\\\)[^\r\n<>|*?"]+?\.[a-z0-9]+)(?=$|[\s,;，；)）\]])/gim;
  return linked
    .split(/(```[\s\S]*?```|`[^`]*`|\[[^\]]+\]\([^)]*\))/g)
    .map((segment, index) =>
      index % 2
        ? segment
        : segment.replace(pattern, (whole, prefix: string, target: string) =>
            fileEditorForTarget(registry, target)
              ? `${prefix}${fileEditorMarkdown(fileName(target), target)}`
              : whole,
          ),
    )
    .join("");
}

function fileEditorMarkdown(label: string, target: string): string {
  return `[${label}](#ovule-office=${encodeURIComponent(target)})`;
}

export const fileEditorForTarget = (registry: MessagePresentationRegistry, value: string) =>
  registry.fileEditor(value);

function fileName(value: string): string {
  return value.split(/[\\/]/).at(-1) || value;
}

function decodeMarkdownDestination(value: string): string | undefined {
  try {
    if (/^file:\/\//i.test(value)) {
      return decodeURIComponent(new URL(value).pathname).replace(/^\/([A-Za-z]:)/, "$1");
    }
    return decodeURIComponent(value.replace(/^<|>$/g, ""));
  } catch {
    return undefined;
  }
}

export function workspaceOfficeTarget(
  registry: MessagePresentationRegistry,
  value?: string | null,
): string | undefined {
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("ovule-attachment:")) {
    return undefined;
  }
  const target = decodeMarkdownDestination(value);
  return target && fileEditorForTarget(registry, target) ? target : undefined;
}
