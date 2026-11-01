import * as Primitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const AlertDialog = Primitive.Root;
export const AlertDialogTrigger = Primitive.Trigger;
export const AlertDialogCancel = Primitive.Cancel;
export const AlertDialogAction = Primitive.Action;
export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="ui-dialog-overlay" />
      <Primitive.Content
        data-slot="alert-dialog-content"
        className={cn("ui-dialog-content", className)}
        {...props}
      />
    </Primitive.Portal>
  );
}
export function AlertDialogHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("ui-dialog-header", className)}
      {...props}
    />
  );
}
export function AlertDialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("ui-dialog-footer", className)}
      {...props}
    />
  );
}
export const AlertDialogTitle = Primitive.Title;
export const AlertDialogDescription = Primitive.Description;
