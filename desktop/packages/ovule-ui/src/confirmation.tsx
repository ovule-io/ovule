import type { ComponentProps } from "react";
import { cn } from "./cn";
import { Button } from "./button";
import styles from "./confirmation.module.css";

/** shadcn AI Elements Confirmation: an outlined Item with content and actions. */
export function Confirmation({ className, ...props }: ComponentProps<"section">) {
  return <section data-slot="confirmation" className={cn(styles.item, className)} {...props} />;
}
export function ConfirmationContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="item-content" className={cn(styles.content, className)} {...props} />;
}
export function ConfirmationTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="item-title" className={cn(styles.title, className)} {...props} />;
}
export function ConfirmationDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p data-slot="item-description" className={cn(styles.description, className)} {...props} />
  );
}
export function ConfirmationActions({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="item-actions" className={cn(styles.actions, className)} {...props} />;
}
export function ConfirmationAction({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button type="button" size="sm" className={cn(styles.action, className)} {...props} />;
}
