import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@ovule/ui/cn";
import styles from "./PaneToolbar.module.css";

export function PaneAddMenu({ className, ...props }: ComponentProps<"div">) {
  const anchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    const toolbar = element?.closest("[data-workspace-titlebar]");
    if (!element || !toolbar) return;
    const update = () => {
      const right = Math.min(toolbar.getBoundingClientRect().right, window.innerWidth);
      const available = Math.max(0, right - element.getBoundingClientRect().left - 8);
      element.style.setProperty("--pane-add-max-width", `${available}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  });
  return <div {...props} ref={anchor} className={cn(styles.paneAddMenu, className)} />;
}
