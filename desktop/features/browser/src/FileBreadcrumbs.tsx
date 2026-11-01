import "./FileBreadcrumbs.css";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, File, Folder, ArrowUp } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@ovule/ui/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@ovule/ui/overlays";

import type { DirectoryLoader, LocalFileEntry } from "./route";
export type { DirectoryLoader } from "./route";
export function fileBreadcrumbs(address: string): { label: string; url: string }[] {
  try {
    const url = new URL(address);
    if (url.protocol !== "file:") return [];
    const parts = url.pathname.split("/").filter(Boolean);
    return [
      { label: url.host || "/", url: `file://${url.host}/` },
      ...parts.map((part, index) => ({
        label: decodeURIComponent(part),
        url: `file://${url.host}/${parts.slice(0, index + 1).join("/")}${index < parts.length - 1 || url.pathname.endsWith("/") ? "/" : ""}`,
      })),
    ];
  } catch {
    return [];
  }
}

/** Collapse one more ancestor at a time; root and current file stay visible. */
export function collapsedAncestorCount(widths: number[], available: number): number {
  if (widths.length < 3) return 0;
  const total = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * 24;
  if (total <= available) return 0;
  let width = total + 32 + 24;
  for (let hidden = 1; hidden <= widths.length - 2; hidden++) {
    width -= widths[hidden] + 24;
    if (width <= available) return hidden;
  }
  return widths.length - 2;
}

export function FileBreadcrumbs({
  address,
  onNavigate,
  loadDirectory,
}: {
  address: string;
  onNavigate(url: string): void;
  loadDirectory?: DirectoryLoader;
}) {
  const parts = fileBreadcrumbs(address);
  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLOListElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const skipRestoreFocus = useRef(false);
  const [collapsed, setCollapsed] = useState(0);
  const [open, setOpen] = useState<string>();
  const [directory, setDirectory] = useState<string>();
  const [listing, setListing] = useState<{
    url: string;
    entries?: LocalFileEntry[];
    error?: string;
  }>();
  const [filter, setFilter] = useState("");
  const request = useRef(0);
  useEffect(() => {
    setOpen(undefined);
    setDirectory(undefined);
    setFilter("");
  }, [address]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      skipRestoreFocus.current = true;
      setOpen(undefined);
    };
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (
        (container.current && path.includes(container.current)) ||
        (panel.current && path.includes(panel.current))
      )
        return;
      dismiss();
    };
    document.addEventListener("pointerdown", outside, true);
    // Native Explorer and iframe input is delivered in another document. Its
    // focus handoff blurs this window without sending a parent pointer event.
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);
  useLayoutEffect(() => {
    const root = container.current;
    const list = measure.current;
    if (!root || !list) return;
    const update = () =>
      setCollapsed(
        collapsedAncestorCount(
          Array.from(list.children).map((node) => node.getBoundingClientRect().width),
          root.clientWidth,
        ),
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    observer.observe(list);
    return () => observer.disconnect();
  }, [address]);
  useEffect(() => {
    if (!directory || !open) return;
    const revision = ++request.current;
    setListing(undefined);
    if (!loadDirectory) {
      setListing({ url: directory, error: "Directory listing is unavailable" });
      return;
    }
    void loadDirectory(directory)
      .then((entries) => {
        if (revision === request.current) setListing({ url: directory, entries });
      })
      .catch((error) => {
        if (revision === request.current) setListing({ url: directory, error: String(error) });
      });
    return () => {
      request.current++;
    };
  }, [directory, open, loadDirectory]);
  if (!parts.length) return null;
  const chooseDirectory = (url: string) => {
    setDirectory(url);
    setFilter("");
  };
  const openNode = (index: number) => {
    skipRestoreFocus.current = false;
    const part = parts[index];
    chooseDirectory(
      index === parts.length - 1 && !address.endsWith("/")
        ? parts[Math.max(0, index - 1)].url
        : part.url,
    );
    setOpen(part.url);
  };
  const listingContent = () => (
    <div className="cm-file-picker" data-file-picker>
      <header>
        <button
          type="button"
          aria-label="Parent directory"
          disabled={!directory || new URL(directory).pathname === "/"}
          onClick={() => chooseDirectory(new URL("../", directory).href)}
        >
          <ArrowUp size={14} />
        </button>
        <span title={directory}>{fileBreadcrumbs(directory ?? "").at(-1)?.label}</span>
      </header>
      <input
        aria-label="Filter files"
        placeholder="Filter files…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="cm-file-picker-entries">
        {!listing || listing.url !== directory ? (
          <p role="status">Loading…</p>
        ) : listing.error ? (
          <p role="alert">{listing.error}</p>
        ) : (
          <>
            {listing.entries
              ?.filter((entry) =>
                entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
              )
              .map((entry) => (
                <button
                  type="button"
                  key={entry.url}
                  title={entry.name}
                  aria-current={entry.url === address ? "page" : undefined}
                  onClick={() => {
                    if (entry.isDirectory) chooseDirectory(entry.url);
                    else {
                      setOpen(undefined);
                      onNavigate(entry.url);
                    }
                  }}
                >
                  {entry.isDirectory ? <Folder size={16} /> : <File size={16} />}
                  <span>{entry.name}</span>
                  {entry.isDirectory && <ChevronRight size={14} />}
                </button>
              ))}
            {!listing.entries?.some((entry) =>
              entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
            ) && <p role="status">No files</p>}
          </>
        )}
      </div>
    </div>
  );
  return (
    <div className="cm-file-breadcrumb-container" ref={container}>
      <ol className="cm-file-breadcrumb-measure" ref={measure} aria-hidden="true">
        {parts.map((part) => (
          <li key={part.url}>{part.label}</li>
        ))}
      </ol>
      <Breadcrumb className="cm-file-breadcrumb" title={address}>
        <BreadcrumbList>
          {parts.map((part, index) => {
            if (index > 0 && index <= collapsed)
              return index === 1 ? (
                <Fragment key="collapsed">
                  <BreadcrumbSeparator>
                    <ChevronRight size={14} />
                  </BreadcrumbSeparator>
                  <BreadcrumbItem>
                    <Popover
                      open={open === "collapsed"}
                      onOpenChange={(value) => {
                        setOpen(value ? "collapsed" : undefined);
                        if (value) {
                          setDirectory(undefined);
                          skipRestoreFocus.current = false;
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="Show hidden folders"
                          className="cm-file-crumb"
                        >
                          …
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        ref={panel}
                        onCloseAutoFocus={(event) => {
                          if (skipRestoreFocus.current) event.preventDefault();
                        }}
                        align="start"
                        className="cm-file-picker-popover"
                        data-file-picker-popover
                      >
                        {directory ? (
                          listingContent()
                        ) : (
                          <div className="cm-file-picker-hidden">
                            {parts.slice(1, collapsed + 1).map((hidden) => (
                              <button
                                type="button"
                                key={hidden.url}
                                title={hidden.url}
                                onClick={() => chooseDirectory(hidden.url)}
                              >
                                <Folder size={16} />
                                {hidden.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </BreadcrumbItem>
                </Fragment>
              ) : null;
            return (
              <Fragment key={part.url}>
                {index > 0 && (
                  <BreadcrumbSeparator>
                    <ChevronRight size={14} />
                  </BreadcrumbSeparator>
                )}
                <BreadcrumbItem>
                  <Popover
                    open={open === part.url}
                    onOpenChange={(value) => {
                      if (value) openNode(index);
                      else setOpen(undefined);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="cm-file-crumb"
                        title={part.url}
                        aria-current={index === parts.length - 1 ? "page" : undefined}
                      >
                        {part.label}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      ref={panel}
                      onCloseAutoFocus={(event) => {
                        if (skipRestoreFocus.current) event.preventDefault();
                      }}
                      align="start"
                      className="cm-file-picker-popover"
                      data-file-picker-popover
                    >
                      {listingContent()}
                    </PopoverContent>
                  </Popover>
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
