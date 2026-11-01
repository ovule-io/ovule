import { PaneLoading } from "@ovule/ui/pane-loading";
import { Suspense } from "react";
import { RouteServicesProvider } from "@/providers";
import { PaneApp } from "./PaneApp";
import { registerPaneServices } from "./services";

export default function PaneRoute() {
  return (
    <RouteServicesProvider register={registerPaneServices}>
      <Suspense fallback={<PaneLoading />}>
        <PaneApp />
      </Suspense>
    </RouteServicesProvider>
  );
}
