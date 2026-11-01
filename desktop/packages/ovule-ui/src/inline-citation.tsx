import type { ReactNode } from "react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "./overlays";
import styles from "./inline-citation.module.css";
export function InlineCitation({
  href,
  title,
  description,
  children,
  onOpen,
}: {
  href: string;
  title: string;
  description?: string;
  children: ReactNode;
  onOpen?(): void;
}) {
  let source: URL;
  try {
    source = new URL(href);
  } catch {
    return <span>{children}</span>;
  }
  if (!["http:", "https:"].includes(source.protocol)) return <span>{children}</span>;
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          data-slot="inline-citation"
          className={styles.citation}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={title}
          onClick={
            onOpen
              ? (event) => {
                  event.preventDefault();
                  onOpen();
                }
              : undefined
          }
        >
          {children}
        </a>
      </HoverCardTrigger>
      <HoverCardContent className={styles.source}>
        <strong>{title}</strong>
        <span>{source.hostname}</span>
        {description && <p>{description}</p>}
      </HoverCardContent>
    </HoverCard>
  );
}
