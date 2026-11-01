import type { ComponentProps } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./input-group";

/** AI Elements Prompt Input: form + Input Group, retaining application-owned
 * attachment, command, workspace, and agent state. */
export function PromptInput(props: ComponentProps<"form">) {
  return <form data-slot="prompt-input" {...props} />;
}

export const PromptInputBody = InputGroup;
export const PromptInputTextarea = InputGroupTextarea;

export function PromptInputFooter(props: ComponentProps<typeof InputGroupAddon>) {
  return <InputGroupAddon align="block-end" {...props} />;
}

export function PromptInputSubmit({
  busy = false,
  children,
  ...props
}: ComponentProps<typeof InputGroupButton> & { busy?: boolean }) {
  return (
    <InputGroupButton type="submit" size="icon" aria-busy={busy} {...props}>
      {children ??
        (busy ? (
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUp size={16} aria-hidden="true" />
        ))}
    </InputGroupButton>
  );
}
