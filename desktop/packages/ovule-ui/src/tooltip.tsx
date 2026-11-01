import { createPortal } from "react-dom";
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "./cn";

type TooltipSide = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

type TooltipPosition = {
  left: number;
  top: number;
  ready: boolean;
  side: TooltipSide;
};

const TOOLTIP_GAP = 6;
const VIEWPORT_PADDING = 8;

function oppositeSide(side: TooltipSide): TooltipSide {
  switch (side) {
    case "top":
      return "bottom";
    case "right":
      return "left";
    case "bottom":
      return "top";
    case "left":
      return "right";
  }
}

function alignedCoordinate(
  start: number,
  triggerSize: number,
  contentSize: number,
  align: TooltipAlign,
) {
  if (align === "start") return start;
  if (align === "end") return start + triggerSize - contentSize;
  return start + (triggerSize - contentSize) / 2;
}

function getCoordinates(
  trigger: DOMRect,
  content: DOMRect,
  side: TooltipSide,
  align: TooltipAlign,
) {
  if (side === "top" || side === "bottom") {
    return {
      left: alignedCoordinate(
        trigger.left,
        trigger.width,
        content.width,
        align,
      ),
      top:
        side === "top"
          ? trigger.top - content.height - TOOLTIP_GAP
          : trigger.bottom + TOOLTIP_GAP,
    };
  }

  return {
    left:
      side === "left"
        ? trigger.left - content.width - TOOLTIP_GAP
        : trigger.right + TOOLTIP_GAP,
    top: alignedCoordinate(trigger.top, trigger.height, content.height, align),
  };
}

function overflowAmount(
  position: { left: number; top: number },
  content: DOMRect,
) {
  const right = position.left + content.width;
  const bottom = position.top + content.height;

  return (
    Math.max(0, VIEWPORT_PADDING - position.left) +
    Math.max(0, right - (window.innerWidth - VIEWPORT_PADDING)) +
    Math.max(0, VIEWPORT_PADDING - position.top) +
    Math.max(0, bottom - (window.innerHeight - VIEWPORT_PADDING))
  );
}

export function Tooltip({
  content,
  side = "top",
  align = "center",
  className,
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  content: ReactNode;
  side?: TooltipSide;
  align?: TooltipAlign;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    ready: false,
    side,
  });

  const updatePosition = useCallback(() => {
    const triggerElement = triggerRef.current;
    const contentElement = contentRef.current;
    if (!triggerElement || !contentElement) return;

    const triggerRect = triggerElement.getBoundingClientRect();
    const contentRect = contentElement.getBoundingClientRect();
    const opposite = oppositeSide(side);
    const preferredPosition = getCoordinates(
      triggerRect,
      contentRect,
      side,
      align,
    );
    const oppositePosition = getCoordinates(
      triggerRect,
      contentRect,
      opposite,
      align,
    );
    const resolvedSide =
      overflowAmount(oppositePosition, contentRect) <
      overflowAmount(preferredPosition, contentRect)
        ? opposite
        : side;
    const resolvedPosition =
      resolvedSide === side ? preferredPosition : oppositePosition;
    const maxLeft = Math.max(
      VIEWPORT_PADDING,
      window.innerWidth - contentRect.width - VIEWPORT_PADDING,
    );
    const maxTop = Math.max(
      VIEWPORT_PADDING,
      window.innerHeight - contentRect.height - VIEWPORT_PADDING,
    );

    setPosition({
      left: Math.min(
        Math.max(resolvedPosition.left, VIEWPORT_PADDING),
        maxLeft,
      ),
      top: Math.min(Math.max(resolvedPosition.top, VIEWPORT_PADDING), maxTop),
      ready: true,
      side: resolvedSide,
    });
  }, [align, side]);

  useLayoutEffect(() => {
    if (!open) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const resizeObserver = new ResizeObserver(updatePosition);
    if (triggerRef.current) resizeObserver.observe(triggerRef.current);
    if (contentRef.current) resizeObserver.observe(contentRef.current);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver.disconnect();
    };
  }, [open, updatePosition]);

  return (
    <span
      ref={triggerRef}
      className={cn("ui-tooltip", className)}
      data-side={side}
      data-align={align}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        setOpen(true);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        setOpen(false);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        setOpen(true);
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      {...props}
    >
      {children}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={contentRef}
            id={tooltipId}
            role="tooltip"
            className="ui-tooltip-content"
            data-side={position.side}
            style={{
              left: position.left,
              top: position.top,
              visibility: position.ready ? "visible" : "hidden",
            }}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
