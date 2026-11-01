import remotingTokens from "./remoting.token";
import type { Register } from "@ovule/ioc";
import type { RemoteControlService } from "./remoting";
import { encodeSpiceSession } from "./session-links-codec";
import { encodeLinkRemoteControlSession } from "./session-links-codec";
import { nativeRemoteControlService } from "./native-adapter";
import { value } from "@ovule/ioc";
export default function register(
  register: Register,
  options: { overrides?: Parameters<typeof registerRemoting>[1] } = {},
): void {
  registerRemoting(register, options.overrides);
}

function registerRemoting(
  register: Register,
  overrides: {
    remoteControl?: RemoteControlService;
  } = {},
): void {
  register(
    remotingTokens.remoteControl,
    value(overrides.remoteControl ?? nativeRemoteControlService),
  );
  register(
    remotingTokens.sessionLinks,
    value({ encodeSpiceSession, encodeLinkRemoteControlSession }),
  );
}
