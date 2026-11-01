import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "./cn";
import { Textarea } from "./form";
import { Button } from "./button";

export function InputGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      data-slot="input-group"
      className={cn("ui-input-group", className)}
      {...props}
    />
  );
}

export function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  align?: "inline-start" | "inline-end" | "block-start" | "block-end";
}) {
  return (
    <div
      data-align={align}
      data-slot="input-group-addon"
      className={cn("ui-input-group-addon", className)}
      {...props}
    />
  );
}

export function InputGroupText({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="input-group-text"
      className={cn("ui-input-group-text", className)}
      {...props}
    />
  );
}

export function InputGroupTextarea({
  className,
  ...props
}: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn("ui-input-group-textarea", className)}
      {...props}
    />
  );
}
export function InputGroupButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="input-group-button"
      className={cn("ui-input-group-button", className)}
      {...props}
    />
  );
}
