import { createToken, tokens } from "@ovule/ioc";
import type { RouteRuntime } from "./route";
import type { ShellService } from "./shell";
import type { SnapshotSyncService } from "./snapshot-sync";

export default tokens({
  routeRuntime: createToken<RouteRuntime>("shellRouteRuntime"),
  shell: createToken<ShellService>("ShellService"),
  snapshotSync: createToken<SnapshotSyncService>("SnapshotSyncService"),
});
