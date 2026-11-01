import * as TogglePrimitive from "@radix-ui/react-toggle";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "./cn";

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd data-slot="kbd" className={cn("ui-kbd", className)} {...props} />;
}

export function Toggle({
  className,
  ...props
}: ComponentProps<typeof TogglePrimitive.Root>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn("ui-toggle", className)}
      {...props}
    />
  );
}

export function ButtonGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="button-group"
      role="group"
      className={cn("ui-button-group", className)}
      {...props}
    />
  );
}

export function AvatarGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn("ui-avatar-group", className)}
      {...props}
    />
  );
}

export function AvatarGroupCount({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="avatar-group-count"
      className={cn("ui-avatar-group-count", className)}
      {...props}
    />
  );
}
