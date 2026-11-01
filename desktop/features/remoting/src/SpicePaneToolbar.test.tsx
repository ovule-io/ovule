import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SpicePaneToolbar } from "./SpicePaneToolbar";
import { encodeLinkRemoteControlSession, encodeSpiceSession } from "./session-links-codec";
import type { PaneInstance } from "@ovule/panes/tab";

const tab: PaneInstance = {
  id: "remote",
  kind: "spice",
  title: "Remote desktop",
  requestVersion: 0,
  target: encodeLinkRemoteControlSession({ endpointId: "host", displayName: "Host" }),
};
test("link pane toolbar contains compact selectors and disables input until connected", () => {
  const html = renderToStaticMarkup(<SpicePaneToolbar tab={tab} command={() => {}} />);
  expect(html).toContain("spice.connectionMode");
  expect(html).toContain("spice.quality");
  expect(html).toContain("spice.connectionAuto");
  expect(html).toContain("spice.qualityBalanced");
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).not.toContain("browser.closeTab");
});
test("toolbar reflects session settings and enables remote input when connected", () => {
  const html = renderToStaticMarkup(
    <SpicePaneToolbar
      tab={{ ...tab, toolbarState: { status: "connected", mode: "relay", quality: "detail" } }}
      command={() => {}}
    />,
  );
  expect(html).toContain("spice.connectionRelay");
  expect(html).toContain("spice.qualityDetail");
  expect(html).not.toContain('disabled=""');
});
test("legacy spice exposes its supported actions without link transport selectors", () => {
  const html = renderToStaticMarkup(
    <SpicePaneToolbar
      tab={{
        ...tab,
        target: encodeSpiceSession({
          endpointId: "host",
          displayName: "Host",
          websocketUrl: "wss://example.com/spice",
        }),
      }}
      command={() => {}}
    />,
  );
  expect(html).not.toContain("spice.connectionMode");
  expect(html).not.toContain("spice.quality");
  expect(html).toContain("spice.syncClipboard");
  expect(html).toContain("spice.reconnect");
});
