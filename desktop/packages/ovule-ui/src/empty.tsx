import type { HTMLAttributes } from "react";
import { cn } from "./cn";
export function Empty({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="empty" className={cn("ui-empty", className)} {...props} />
  );
}
export function EmptyHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="empty-header"
      className={cn("ui-empty-header", className)}
      {...props}
    />
  );
}
export function EmptyTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      data-slot="empty-title"
      className={cn("ui-empty-title", className)}
      {...props}
    />
  );
}
export function EmptyDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="empty-description"
      className={cn("ui-empty-description", className)}
      {...props}
    />
  );
}
