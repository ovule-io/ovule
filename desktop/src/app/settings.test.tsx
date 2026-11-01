import settingsTokens from "@ovule/settings/settings.token";
import hostsTokens from "@ovule/hosts/hosts.token";
import { describe, expect, test } from "bun:test";
import { value } from "@ovule/ioc";
import { createRegistry, createScope } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import { renderToReadableStream } from "react-dom/server";
import { registerSettingsServices } from "./main/settings-services";
import { useService } from "@ovule/ioc/react";
import type { SettingsSectionProps } from "@ovule/settings/settings/settings";
import { registerDesktopServices } from "./services";
import type { AppSnapshot } from "@ovule/shell-api";

describe("settings feature injection", () => {
  test("the navigation renders an injected Hosts view without importing its implementation", async () => {
    const container = registerSettingsServices(createRegistry()).register(
      settingsTokens.hostsSettingsView,
      value(() => <div>Injected Hosts feature</div>),
    );
    registerDesktopServices(container);
    const stream = await renderToReadableStream(
      <ScopeProvider registry={container}>
        <SettingsPanel
          initialSection="hosts"
          snapshot={{ threads: [] } as unknown as AppSnapshot}
          busy={false}
          invoke={async () => true}
        />
      </ScopeProvider>,
    );
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("Injected Hosts feature");
  });
  test("reset completion survives remount scopes while independent apps keep separate state", () => {
    const app = createScope(registerSettingsServices(createRegistry()));
    const first = createScope(createRegistry(), app).get(hostsTokens.hostsViewState);
    first.patch({ clearedLegacyLinkKey: "old-binding", hiddenHostIdentityId: "new-identity" });
    const remounted = createScope(createRegistry(), app).get(hostsTokens.hostsViewState);
    expect(remounted.current()).toEqual({
      clearedLegacyLinkKey: "old-binding",
      hiddenHostIdentityId: "new-identity",
    });
    expect(
      createScope(registerSettingsServices(createRegistry()))
        .get(hostsTokens.hostsViewState)
        .current(),
    ).toEqual({});
  });
});

function SettingsPanel(props: SettingsSectionProps & { initialSection?: "hosts" }) {
  const View = useService(settingsTokens.settingsPanelView);
  return <View {...props} />;
}
