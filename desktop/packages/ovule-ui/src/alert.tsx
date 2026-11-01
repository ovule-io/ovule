import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn("ui-alert", className)}
      {...props}
    />
  );
}
export function AlertTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      data-slot="alert-title"
      className={cn("ui-alert-title", className)}
      {...props}
    />
  );
}
export function AlertDescription({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-description"
      className={cn("ui-alert-description", className)}
      {...props}
    />
  );
}
