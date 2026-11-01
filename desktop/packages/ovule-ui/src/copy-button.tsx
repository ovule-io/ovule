import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./button";
export type CopyButtonProps = Omit<ComponentProps<typeof Button>, "onCopy" | "onError"> & {
  text: string;
  onCopy?(): void;
  onError?(error: Error): void;
};
/** Clipboard behavior shared by code blocks and terminal output. */
export function CopyButton({ text, onCopy, onError, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-slot="copy-button"
      {...props}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          onCopy?.();
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        } catch (error) {
          setCopied(false);
          onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}
