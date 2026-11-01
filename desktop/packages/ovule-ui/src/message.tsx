import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller as useMessageScrollerPrimitive,
} from "@shadcn/react/message-scroller";
import type { ComponentProps, HTMLAttributes } from "react";

import { cn } from "./cn";

export function useMessageScroller() {
  return useMessageScrollerPrimitive();
}

export function MessageScrollerProvider(
  props: ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

export function MessageScroller({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root className={cn("ui-message-scroller", className)} {...props} />
  );
}

export function MessageScrollerViewport({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      className={cn("ui-message-scroller-viewport", className)}
      {...props}
    />
  );
}

export function MessageScrollerContent({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      className={cn("ui-message-scroller-content", className)}
      {...props}
    />
  );
}

export function MessageScrollerButton({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      className={cn("ui-message-scroller-button", className)}
      {...props}
    />
  );
}

export function MessageScrollerItem({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item className={cn("ui-message-animated", className)} {...props} />
  );
}

export function Message({
  className,
  from = "assistant",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  from?: "assistant" | "system" | "user";
}) {
  return (
    <div
      data-slot="message"
      className={cn("ui-message", className)}
      data-role={from}
      data-align={from === "user" ? "end" : "start"}
      {...props}
    />
  );
}

export function MessageAvatar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-slot="message-avatar"
      className={cn("ui-message-avatar", className)}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="message-content" className={cn("ui-message-content", className)} {...props} />
  );
}

export function MessageHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header data-slot="message-header" className={cn("ui-message-header", className)} {...props} />
  );
}

export function MessageFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer data-slot="message-footer" className={cn("ui-message-footer", className)} {...props} />
  );
}

/** A person's turn uses a bubble; agent Markdown stays on the thread surface. */
export function MessageBubble({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="bubble" className={cn("ui-message-bubble", className)} {...props} />;
}
