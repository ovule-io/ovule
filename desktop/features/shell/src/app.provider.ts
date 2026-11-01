import shellTokens from "./shell.token";
import type { Register } from "@ovule/ioc";
import { value } from "@ovule/ioc";
import { openPopupWindow } from "./window-platform";
import { windowApi } from "./window-platform";
import { explorerOpenDestination } from "./explorer-navigation";
import type { ShellService } from "./shell";
import { defaultShellService } from "./service";
import { DownloadsButton } from "./DownloadsButton";
export default function register(
  register: Register,
  options: { overrides?: Parameters<typeof registerShell>[1] } = {},
): void {
  registerRoute(register);
  registerShell(register, options.overrides);
}

function registerRoute(register: Register): void {
  register(
    shellTokens.routeRuntime,
    value({ openPopupWindow, windowApi, explorerOpenDestination, DownloadsButton }),
  );
}

function registerShell(
  register: Register,
  overrides: {
    shell?: ShellService;
  } = {},
): void {
  register(shellTokens.shell, value(overrides.shell ?? defaultShellService));
}
