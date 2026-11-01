import { createToken, tokens } from "@ovule/ioc";
import type { ComposerService } from "./composer/composer";
import type { RouteRuntime as ComposerRouteRuntime } from "./composer/route";
import type { ComposerSuggestionRegistry } from "./composer/suggestions";
import type { ConversationStateService, ConversationStateController } from "./state";
import type { RouteRuntime as MessageTelemetryRouteRuntime } from "./message-telemetry/route";

import type { ConversationViewTokenValue } from "./view";
import type { RouteRuntime } from "./route";
import type { SelectionService } from "./selection/selection";
import type { MessagePresentationRegistry } from "./messages/message-list";
import type { RouteRuntime as MessageRouteRuntime } from "./messages/route";
export default tokens({
  messagePresentationRegistry: createToken<MessagePresentationRegistry>(
    "MessagePresentationRegistry",
  ),
  messageRouteRuntime: createToken<MessageRouteRuntime>("conversationMessageRouteRuntime"),
  conversationView: createToken<ConversationViewTokenValue>("ConversationView"),
  routeRuntime: createToken<RouteRuntime>("conversationRouteRuntime"),
  selection: createToken<SelectionService>("SelectionService"),
  composer: createToken<ComposerService>("ComposerService"),
  composerRouteRuntime: createToken<ComposerRouteRuntime>("composerRouteRuntime"),
  composerSuggestionRegistry: createToken<ComposerSuggestionRegistry>("ComposerSuggestionRegistry"),
  stateController: createToken<ConversationStateController>("ConversationStateController"),
  conversationState: createToken<ConversationStateService>("ConversationStateService"),
  messageTelemetryRouteRuntime: createToken<MessageTelemetryRouteRuntime>(
    "message-telemetryRouteRuntime",
  ),
});
