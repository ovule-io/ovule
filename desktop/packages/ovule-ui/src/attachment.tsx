import type { ComponentProps, HTMLAttributes, ImgHTMLAttributes } from "react";
import { cn } from "./cn";
import { Button } from "./button";
import styles from "./attachment.module.css";

export function Attachment({
  className,
  orientation,
  state = "done",
  ...props
}: HTMLAttributes<HTMLElement> & {
  orientation?: "horizontal" | "vertical";
  state?: "idle" | "uploading" | "processing" | "error" | "done";
}) {
  return (
    <figure
      data-slot="attachment"
      data-orientation={orientation}
      data-state={state}
      aria-busy={state === "uploading" || state === "processing" || undefined}
      className={cn("ui-attachment", orientation && styles.root, className)}
      {...props}
    />
  );
}
export function AttachmentPreview({ className, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      data-slot="attachment-preview"
      className={cn("ui-attachment-preview", className)}
      {...props}
    />
  );
}
export function AttachmentContent({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <figcaption
      data-slot="attachment-content"
      className={cn("ui-attachment-content", className)}
      {...props}
    />
  );
}
export function AttachmentGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="attachment-group" className={cn("ui-attachment-group", className)} {...props} />
  );
}

export function AttachmentMedia({
  className,
  variant = "icon",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "icon" | "image" }) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(styles.media, className)}
      {...props}
    />
  );
}
export function AttachmentTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="attachment-title" className={cn(styles.title, className)} {...props} />;
}
export function AttachmentDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="attachment-description"
      className={cn(styles.description, className)}
      {...props}
    />
  );
}
export function AttachmentActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="attachment-actions" className={cn(styles.actions, className)} {...props} />
  );
}
export function AttachmentAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(styles.action, className)}
      {...props}
    />
  );
}
export function AttachmentTrigger({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="attachment-trigger"
      className={cn(styles.trigger, className)}
      {...props}
    />
  );
}
