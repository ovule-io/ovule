import type { ComponentProps } from "react";
import { TerminalSquare } from "lucide-react";
import { cn } from "./cn";
import styles from "./terminal.module.css";
export function Terminal({ className, ...props }: ComponentProps<"section">) {
  return <section data-slot="terminal" className={cn(styles.terminal, className)} {...props} />;
}
export function TerminalHeader({ children, ...props }: ComponentProps<"header">) {
  return (
    <header data-slot="terminal-header" className={styles.header} {...props}>
      <TerminalSquare size={14} aria-hidden="true" />
      {children}
    </header>
  );
}
export function TerminalOutput({ children, ...props }: ComponentProps<"pre">) {
  return (
    <pre data-slot="terminal-output" className={styles.output} {...props}>
      {children}
    </pre>
  );
}
