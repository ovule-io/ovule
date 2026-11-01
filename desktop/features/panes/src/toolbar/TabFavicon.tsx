import { useEffect, useState } from "react";

import type { PaneInstance } from "@ovule/panes/tab";
import { paneIcons } from "./paneIcons";
import { cn } from "@ovule/ui/cn";
import styles from "./PaneToolbar.module.css";

export function TabFavicon({ tab, className = "" }: { tab: PaneInstance; className?: string }) {
  const Icon = paneIcons[tab.kind];
  const url = tab.url ?? tab.target ?? "";
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [url, tab.favicon]);

  let favicon = tab.favicon;
  if (!favicon && /^https?:\/\//i.test(url)) {
    try {
      favicon = new URL("/favicon.ico", url).href;
    } catch {
      // Invalid addresses retain the registered pane icon.
    }
  }

  return favicon && !failed ? (
    <img
      className={cn(styles.tabFavicon, className)}
      src={favicon}
      alt=""
      onError={() => setFailed(true)}
    />
  ) : (
    <Icon className={cn(styles.tabFavicon, className)} />
  );
}
