import { createToken, tokens } from "@ovule/ioc";
import type { WorkbenchViewTokenValue } from "./view";

export default tokens({
  workbenchView: createToken<WorkbenchViewTokenValue>("WorkbenchView"),
});
