import { createContext, useContext, type ComponentProps } from "react";
import { CodeBlock as HighlightedCode } from "streamdown";
import { CopyButton, type CopyButtonProps } from "./copy-button";
import { cn } from "./cn";
import styles from "./code-block.module.css";
const CodeContext = createContext("");
/** Local shadcn-style Code Block adapter retaining Streamdown highlighting. */
export function CodeBlock({
  children,
  className,
  ...props
}: ComponentProps<typeof HighlightedCode>) {
  return (
    <CodeContext.Provider value={props.code}>
      <section data-slot="code-block" className={cn(styles.panel, className)}>
        <header data-slot="code-block-header" className={styles.header}>
          <span className={styles.title}>{props.language || "text"}</span>
          <div className={styles.actions}>{children}</div>
        </header>
        <div data-slot="code-block-content" className={styles.code}>
          <HighlightedCode {...props}>
            <span />
          </HighlightedCode>
        </div>
      </section>
    </CodeContext.Provider>
  );
}
export function CodeBlockCopyButton({
  code,
  ...props
}: Omit<CopyButtonProps, "text"> & { code?: string }) {
  const contextCode = useContext(CodeContext);
  return (
    <CopyButton text={code ?? contextCode} data-streamdown="code-block-copy-button" {...props} />
  );
}
