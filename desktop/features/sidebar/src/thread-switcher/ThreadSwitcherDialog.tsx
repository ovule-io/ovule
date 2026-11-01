import { Input } from "@ovule/ui/form";
import { MessageSquareText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import { Kbd } from "@ovule/ui/controls";
import { InputGroup, InputGroupAddon } from "@ovule/ui/input-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ovule/ui/dialog";
import { cn } from "@ovule/ui/cn";
import type { ThreadView } from "@ovule/shell-api";
import styles from "./ThreadSwitcherDialog.module.css";

export function ThreadSwitcherDialog({
  open,
  threads,
  selectedThreadId,
  onOpenChange,
  onSelectThread,
}: {
  open: boolean;
  threads: ThreadView[];
  selectedThreadId?: string;
  onOpenChange(open: boolean): void;
  onSelectThread(id: string): void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return threads.filter((thread) =>
      [thread.title, thread.workspacePath, thread.agent].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [query, threads]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(
      Math.max(
        0,
        threads.findIndex((thread) => thread.id === selectedThreadId),
      ),
    );
    requestAnimationFrame(() => input.current?.focus());
  }, [open, selectedThreadId, threads]);
  useEffect(() => setActiveIndex(0), [query]);

  const choose = (thread: ThreadView | undefined) => {
    if (!thread) return;
    onSelectThread(thread.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>{t("threadSwitcher.title")}</DialogTitle>
          <DialogDescription>{t("threadSwitcher.description")}</DialogDescription>
        </DialogHeader>
        <InputGroup className={styles.search}>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <Input
            className={styles.searchInput}
            ref={input}
            aria-label={t("threadSwitcher.search")}
            placeholder={t("threadSwitcher.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (!visible.length) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex((index) => (index + direction + visible.length) % visible.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(visible[activeIndex] ?? visible[0]);
              }
            }}
          />
          <InputGroupAddon>
            <Kbd className={styles.searchShortcut}>Esc</Kbd>
          </InputGroupAddon>
        </InputGroup>
        <div className={styles.list} role="listbox" aria-label={t("threadSwitcher.results")}>
          {visible.length ? (
            visible.map((thread, index) => (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                role="option"
                aria-selected={thread.id === selectedThreadId}
                className={cn(styles.thread, index === activeIndex && styles.active)}
                key={thread.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(thread)}
              >
                <MessageSquareText />
                <span className={styles.threadText}>
                  <strong className={cn(styles.threadLine, styles.threadTitle)}>
                    {thread.title}
                  </strong>
                  <small className={cn(styles.threadLine, styles.threadDetail)}>
                    {thread.agent}
                  </small>
                </span>
                {thread.id === selectedThreadId && (
                  <i className={styles.threadCurrent}>{t("threadSwitcher.current")}</i>
                )}
              </Button>
            ))
          ) : (
            <div className={styles.empty}>{t("threadSwitcher.empty")}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
