import { createToken, tokens } from "@ovule/ioc";
import type { OmniboxViewTokenValue } from "./view";

export default tokens({
  omniboxView: createToken<OmniboxViewTokenValue>("OmniboxView"),
});
