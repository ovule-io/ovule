import tokens from "./framework.token";
import { type Register } from "@ovule/ioc";
import { createMainOverlayService } from "./overlay/service";
import registerLayout from "./layout-registration";
export default function register(
  register: Register,
  options: Parameters<typeof registerLayout>[1] = {},
): void {
  registerLayout(register, options);
  register(tokens.mainOverlay, () => createMainOverlayService());
}
