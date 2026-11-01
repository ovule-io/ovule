import { LoaderCircle } from "lucide-react";
import { lazy, Suspense } from "react";

import type { PaneContext } from "@ovule/panes/pane";
import { LinkRemoteControlPanel } from "./LinkRemoteControlPanel";
import { decodeLinkRemoteControlSession } from "./session-links-codec";

const LegacySpiceSessionPanel = lazy(() =>
  import("./LegacySpiceSessionPanel").then((module) => ({
    default: module.LegacySpiceSessionPanel,
  })),
);

export function SpiceSessionPanel(context: PaneContext) {
  const { target, requestVersion } = context;
  const linkRequest = decodeLinkRemoteControlSession(target);
  if (linkRequest) {
    return (
      <LinkRemoteControlPanel
        tabId={context.id}
        request={linkRequest}
        requestVersion={requestVersion}
      />
    );
  }
  return (
    <Suspense
      fallback={
        <main className="grid h-full place-items-center bg-(--background) text-(--muted-foreground)">
          <LoaderCircle className="animate-spin" size={18} />
        </main>
      }
    >
      <LegacySpiceSessionPanel {...context} />
    </Suspense>
  );
}
