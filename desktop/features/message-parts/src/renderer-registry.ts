import type {
  MessagePresentationRegistry,
  MessagePartRenderer,
} from "@ovule/conversation/messages/message-list";
import { MarkdownPart } from "./markdown-part";
import { ImagePart, LinkPart, FilePart } from "./attachment-parts";
import { ToolPart, TerminalPart, CitationPart, CodePart } from "./chat-parts";
import { ThinkingPart } from "./thinking-part";

export function registerMessagePartRenderer(
  registry: MessagePresentationRegistry,
  kind: string,
  renderer: MessagePartRenderer,
): () => void {
  return registry.registerRenderer(kind, renderer);
}

export function registerDefaultMessageRenderers(registry: MessagePresentationRegistry): void {
  registerMessagePartRenderer(registry, "thinking", ThinkingPart);
  for (const kind of ["tool", "tool-call", "tool-result"])
    registerMessagePartRenderer(registry, kind, ToolPart);
  registerMessagePartRenderer(registry, "terminal", TerminalPart);
  registerMessagePartRenderer(registry, "code", CodePart);
  for (const kind of ["citation", "inline-citation", "source-url", "sources"])
    registerMessagePartRenderer(registry, kind, CitationPart);
  registerMessagePartRenderer(registry, "markdown", MarkdownPart);
  registerMessagePartRenderer(registry, "image", ImagePart);
  registerMessagePartRenderer(registry, "file", FilePart);
  registerMessagePartRenderer(registry, "link", LinkPart);
}
