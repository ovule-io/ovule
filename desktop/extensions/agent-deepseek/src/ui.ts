import config from "./onboarding-ui.json";
import { registry } from "./isolated";
import { registerOnboarding } from "./onboarding";
registerOnboarding(registry, config);
