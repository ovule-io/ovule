import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="field" className={cn("ui-field", className)} {...props} />
  );
}
export function FieldLabel({
  className,
  ...props
}: HTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="field-label"
      className={cn("ui-field-label", className)}
      {...props}
    />
  );
}
export function FieldDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-description"
      className={cn("ui-field-description", className)}
      {...props}
    />
  );
}
export function FieldError({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-error"
      className={cn("ui-field-error", className)}
      {...props}
    />
  );
}
