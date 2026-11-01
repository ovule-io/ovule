import workspaceTokens from "@ovule/workspace/workspace.token";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";
import { Input } from "@ovule/ui/form";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { BrowserSuggestion } from "@ovule/shell-api";
import type { OmniboxViewProps } from "./view";
import styles from "./Omnibox.module.css";

const useBrowserSuggestionsFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  return function useBrowserSuggestions({
    threadId,
    query,
    enabled,
    debounceMs,
  }: {
    threadId: string | undefined;
    query: string;
    enabled: boolean;
    debounceMs: number;
  }) {
    const [result, setResult] = useState<{ query: string; items: BrowserSuggestion[] }>({
      query: "",
      items: [],
    });
    const version = useRef(0);
    useEffect(() => {
      const current = ++version.current;
      const trimmed = query.trim();
      if (!enabled || !trimmed) {
        setResult({ query: "", items: [] });
        return;
      }
      const timer = window.setTimeout(() => {
        void workspace
          .api()
          .then((api) => api.browserSuggestions(threadId ?? null, trimmed))
          .then((items) => {
            if (version.current === current) setResult({ query: trimmed, items });
          })
          .catch(() => {
            if (version.current === current) setResult({ query: trimmed, items: [] });
          });
      }, debounceMs);
      return () => window.clearTimeout(timer);
    }, [debounceMs, enabled, query, threadId, workspace]);
    return result;
  };
}, "useBrowserSuggestions");

const useBrowserSuggestions = (
  ...args: Parameters<ServiceOf<typeof useBrowserSuggestionsFactory>>
) => useService(useBrowserSuggestionsFactory)(...args);

export function Omnibox({
  threadId,
  value,
  onValueChange,
  onSubmit,
  onAccept,
  ariaLabel,
  placeholder,
  suggestionsId,
  className,
  inputClassName,
  contentClassName,
  suggestionClassName,
  activeSuggestionClassName,
  suggestionTitleClassName,
  suggestionDetailClassName,
  leadingIcon,
  trailing,
  inputRef,
  inputRole,
  autoFocus,
  selectOnFocus = false,
  suggestionsEnabled = true,
  debounceMs = 100,
  initialActive = 0,
  formatTitle,
  formatDetail,
}: OmniboxViewProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(initialActive);
  const { items: suggestions, query: suggestionsQuery } = useBrowserSuggestions({
    threadId,
    query: value,
    enabled: suggestionsEnabled && open,
    debounceMs,
  });
  useEffect(() => setActive(initialActive), [initialActive, suggestions]);

  const currentQuery = suggestionsQuery === value.trim();
  // While a new query is pending, keep the panel steady but never accept a
  // stale highlighted suggestion when Enter is pressed immediately.
  const activeItem = open && currentQuery && active >= 0 ? suggestions[active] : undefined;
  const showPopover = open && suggestions.length > 0;
  const renderTitle = (suggestion: BrowserSuggestion) =>
    formatTitle?.(suggestion) ?? suggestion.title;
  const renderDetail = (suggestion: BrowserSuggestion) =>
    formatDetail?.(suggestion) ?? suggestion.detail;

  useLayoutEffect(() => {
    const root = anchor.current;
    const expanded = panel.current;
    if (!root || !expanded || !showPopover) return;
    const previousHeight = root.style.height;
    root.style.height = `${root.getBoundingClientRect().height}px`;
    // A manual HTML popover enters the top layer without moving/recreating the
    // input DOM node. The caret and the toolbar's DOM focus ownership survive.
    const position = () => {
      const rect = root.getBoundingClientRect();
      const css = getComputedStyle(root);
      Object.assign(expanded.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
      });
      expanded.style.setProperty("--omnibox-row-height", `${rect.height}px`);
      expanded.style.setProperty(
        "--omnibox-row-gap",
        css.columnGap === "normal" ? "8px" : css.columnGap,
      );
      expanded.style.setProperty(
        "--omnibox-row-padding",
        `${css.paddingTop} ${css.paddingRight} ${css.paddingBottom} ${css.paddingLeft}`,
      );
      expanded.style.setProperty(
        "--omnibox-list-height",
        `${Math.max(60, Math.min(360, innerHeight - rect.bottom - 12))}px`,
      );
    };
    position();
    expanded.setAttribute("popover", "manual");
    expanded.showPopover();
    const resize = new ResizeObserver(position);
    resize.observe(root);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const dismiss = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", dismiss, true);
      if (expanded.matches(":popover-open")) expanded.hidePopover();
      expanded.removeAttribute("popover");
      root.style.height = previousHeight;
    };
  }, [showPopover]);

  return (
    <div ref={anchor} className={className} data-omnibox-expanded={showPopover ? "true" : "false"}>
      <div
        ref={panel}
        className={styles.panel}
        data-expanded={showPopover ? "true" : undefined}
        data-omnibox-panel
      >
        <div className={styles.inputRow}>
          {leadingIcon}
          <Input
            className={inputClassName}
            ref={inputRef}
            autoFocus={autoFocus}
            role={inputRole}
            aria-label={ariaLabel}
            placeholder={placeholder}
            value={value}
            onFocus={(event) => {
              if (selectOnFocus) event.currentTarget.select();
              setOpen(true);
            }}
            onBlur={(event) => {
              if (!anchor.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
            }}
            onChange={(event) => {
              onValueChange(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && suggestions.length) {
                event.preventDefault();
                setActive((index) => (index + 1) % suggestions.length);
              } else if (event.key === "ArrowUp" && suggestions.length) {
                event.preventDefault();
                setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
              } else if (event.key === "Escape") {
                setOpen(false);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (activeItem) void onAccept(activeItem);
                else onSubmit(value);
              }
            }}
            aria-controls={suggestionsId}
            aria-expanded={showPopover}
            aria-activedescendant={activeItem ? `${suggestionsId}-${activeItem.id}` : undefined}
          />
          {trailing}
        </div>
        <div
          id={suggestionsId}
          className={cn(contentClassName, styles.results)}
          role="listbox"
          hidden={!showPopover}
        >
          {suggestions.map((suggestion, index) => (
            <Button
              variant="ghost"
              size="sm"
              id={`${suggestionsId}-${suggestion.id}`}
              key={suggestion.id}
              role="option"
              aria-selected={currentQuery && index === active}
              className={cn(
                suggestionClassName,
                styles.option,
                currentQuery && index === active && activeSuggestionClassName,
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void onAccept(suggestion)}
            >
              <span className={suggestionTitleClassName}>{renderTitle(suggestion)}</span>
              <small className={suggestionDetailClassName}>{renderDetail(suggestion)}</small>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
