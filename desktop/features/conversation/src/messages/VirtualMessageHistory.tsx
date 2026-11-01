import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MessageScrollerItem } from "@ovule/ui/message";

export const HISTORY_BATCH_SIZE = 24;
type Observe = (element: HTMLElement, update: (visible: boolean) => void) => () => void;
const VisibilityContext = createContext<Observe | undefined>(undefined);

/** Share one native observer for all loaded turns; keep measured scroll geometry. */
export function VirtualMessageHistory({
  viewport,
  children,
}: {
  viewport: HTMLElement | null;
  children: ReactNode;
}) {
  const callbacks = useRef(new Map<Element, (visible: boolean) => void>());
  const observer = useMemo(() => {
    if (!viewport || typeof IntersectionObserver === "undefined") return undefined;
    return new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.current.get(entry.target)?.(entry.isIntersecting);
      },
      { root: viewport, rootMargin: "1000px 0px" },
    );
  }, [viewport]);
  useEffect(() => () => observer?.disconnect(), [observer]);
  const observe = useMemo<Observe>(
    () => (element, update) => {
      callbacks.current.set(element, update);
      observer?.observe(element);
      return () => {
        callbacks.current.delete(element);
        observer?.unobserve(element);
      };
    },
    [observer],
  );
  return <VisibilityContext.Provider value={observe}>{children}</VisibilityContext.Provider>;
}

export function VirtualMessageTurn({
  children,
  messageId,
  className,
  scrollAnchor,
  streaming = false,
}: {
  children: ReactNode;
  messageId: string;
  className: string;
  scrollAnchor?: boolean;
  streaming?: boolean;
}) {
  const observe = useContext(VisibilityContext);
  const element = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const [visible, setVisible] = useState(true);
  const mounted = visible || streaming;
  useLayoutEffect(() => {
    const row = element.current;
    if (!row || !mounted) return;
    const measure = () => {
      height.current = row.getBoundingClientRect().height;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(row);
    return () => resize.disconnect();
  }, [mounted]);
  useEffect(() => {
    const row = element.current;
    if (!row) return;
    return observe?.(row, (next) => {
      if (!next && row.contains(document.activeElement)) return;
      if (!next && height.current === 0) height.current = row.getBoundingClientRect().height;
      setVisible(next);
    });
  }, [observe]);
  return (
    <MessageScrollerItem
      ref={element}
      className={className}
      messageId={messageId}
      data-turn-id={messageId}
      scrollAnchor={scrollAnchor}
      data-virtual-message={mounted ? "mounted" : "placeholder"}
      style={mounted ? undefined : { height: height.current, overflow: "hidden" }}
    >
      {mounted ? children : null}
    </MessageScrollerItem>
  );
}
