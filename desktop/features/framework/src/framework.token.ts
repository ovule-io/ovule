import { createToken, tokens } from "@ovule/ioc";
import type { FrameworkLayoutService } from "./framework";
import type { FrameworkViewTokenValue, ContentViewTokenValue } from "./view";

import type { ConversationLayoutViewTokenValue } from "./conversation-layout/view";
import type { RouteRuntime } from "./route";
import type { MainOverlayService } from "./overlay/main-overlay";
export default tokens({
  routeRuntime: createToken<RouteRuntime>("frameworkRouteRuntime"),
  mainOverlay: createToken<MainOverlayService>("MainOverlayService"),
  conversationLayoutView: createToken<ConversationLayoutViewTokenValue>("ConversationLayoutView"),
  frameworkLayout: createToken<FrameworkLayoutService>("FrameworkLayoutService"),
  frameworkView: createToken<FrameworkViewTokenValue>("FrameworkView"),
  contentView: createToken<ContentViewTokenValue>("ContentView"),
});
