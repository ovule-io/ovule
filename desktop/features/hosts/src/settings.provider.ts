import settingsTokens from "@ovule/settings/settings.token";
import hostsTokens from "./hosts.token";
import type { Register } from "@ovule/ioc";
import { lazy } from "react";
import { value } from "@ovule/ioc";
import { createHostsViewState } from "./service";
export default function register(register: Register): void {
  registerSettings(register);
}

function registerSettings(register: Register): void {
  register(hostsTokens.hostsViewState, () => createHostsViewState());
  register(
    settingsTokens.hostsSettingsView,
    value(
      lazy(() =>
        import("./HostsSection.tsx").then((m) => ({
          default: m.HostsSection,
        })),
      ),
    ),
  );
}
