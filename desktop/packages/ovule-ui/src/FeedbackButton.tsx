import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { Tooltip } from "@ovule/ui/tooltip";
import { useActionFeedback } from "@ovule/ui/useActionFeedback";
import styles from "./FeedbackButton.module.css";

export function FeedbackButton({
  label,
  successLabel,
  action,
  children,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & {
  label: string;
  successLabel?: string;
  action(): boolean | void | null | Promise<boolean | void | null>;
}) {
  const { t } = useTranslation();
  const feedback = useActionFeedback();
  const text =
    feedback.status === "success"
      ? (successLabel ?? t("common.actionRequested"))
      : feedback.status === "error"
        ? t("common.actionFailed")
        : label;
  return (
    <Tooltip side="bottom" content={text}>
      <Button
        {...props}
        aria-label={text}
        data-feedback={feedback.status}
        disabled={disabled || feedback.status === "pending"}
        onClick={() => void feedback.run(action)}
      >
        {feedback.status === "success" ? (
          <Check size={14} />
        ) : feedback.status === "error" ? (
          <CircleAlert size={14} />
        ) : feedback.status === "pending" ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          children
        )}
        <span className={styles.status} role="status">
          {feedback.status === "idle" || feedback.status === "pending" ? "" : text}
        </span>
      </Button>
    </Tooltip>
  );
}
