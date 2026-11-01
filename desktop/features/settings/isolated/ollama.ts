import { registry } from "./isolated";
import { registerOnboarding } from "./onboarding";
import config from "./ollama.json";
registerOnboarding(registry, config);
