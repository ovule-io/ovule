import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ThreadMessageView } from "@ovule/shell-api";
import styles from "./ConversationPane.module.css";

/** Keep the current prompt reachable while reading a long reply or tool trace. */
export function TurnContext({
  viewport,
  messages,
}: {
  viewport: HTMLElement | null;
  messages: ThreadMessageView[];
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string>();
  useEffect(() => {
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = viewport.getBoundingClientRect().top + 60;
      const rows = Array.from(viewport.querySelectorAll<HTMLElement>("[data-turn-id]"));
      const row = rows.find((row) => row.getBoundingClientRect().bottom > top);
      const index = messages.findIndex((message) => message.id === row?.dataset.turnId);
      const prompt = messages
        .slice(0, index + 1)
        .reverse()
        .find((message) => message.role === "user");
      const promptRow = rows.find((row) => row.dataset.turnId === prompt?.id);
      setCurrent(
        prompt && promptRow && promptRow.getBoundingClientRect().bottom <= top
          ? prompt.id
          : undefined,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    viewport.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport);
    if (viewport.firstElementChild) resize.observe(viewport.firstElementChild);
    schedule();
    return () => {
      viewport.removeEventListener("scroll", schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [viewport, messages]);
  const promptIndex = messages.findIndex((message) => message.id === current);
  const prompt = messages[promptIndex];
  if (!prompt) return null;
  const jump = (id: string) => {
    const row = Array.from(viewport?.querySelectorAll<HTMLElement>("[data-turn-id]") ?? []).find(
      (row) => row.dataset.turnId === id,
    );
    if (row && viewport)
      viewport.scrollTo({
        top:
          viewport.scrollTop +
          row.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          64,
        behavior: "smooth",
      });
  };
  const text = prompt.parts
    .filter((part) => part.kind === "markdown")
    .map((part) => part.text ?? "")
    .join("\n");
  return (
    <div className={styles.turnContext} data-turn-context>
      <button onClick={() => jump(prompt.id)} title={text || t("conversation.you")}>
        <ArrowUp size={14} />
        <span>{text || t("conversation.you")}</span>
      </button>
    </div>
  );
}
