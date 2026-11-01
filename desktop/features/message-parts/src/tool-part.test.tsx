import { expect, test } from "bun:test";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolPart } from "./chat-parts";

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: {} } } });

test("tool previews expose a collapsible input and backend failure", () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ToolPart
        part={{
          id: "tool-fixture",
          kind: "tool",
          dataJson: JSON.stringify({
            name: "ovule_workspace_exec",
            state: "failed",
            durationMs: 3,
            input: { bindingId: "local", argv: ["ps"] },
            error: "Backend: Unknown or unselected Workspace binding",
          }),
        }}
        streaming={false}
      />
    </I18nextProvider>,
  );
  expect(html).toContain('data-slot="trace-collapsible-trigger"');
  expect(html).toContain("bindingId");
  expect(html).toContain("Unknown or unselected Workspace binding");
  expect(html).toContain('data-state="error"');
  expect(html).toContain("chatElements.errorDetails");
  expect(html).not.toContain('data-status="error"');
});

test("legacy completed cards expose process failure and access warning labels", () => {
  const render = (output: unknown) =>
    renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ToolPart
          part={{
            id: "fixture",
            kind: "tool",
            dataJson: JSON.stringify({ name: "ovule_workspace_exec", state: "completed", output }),
          }}
          streaming={false}
        />
      </I18nextProvider>,
    );
  expect(render({ exit_code: -1, stdout: "", stderr: "rosetta error" })).toContain(
    'data-state="failed"',
  );
  const warning = render({
    exit_code: 0,
    stdout: "",
    stderr: "",
    warnings: ["access_denial_observed"],
  });
  expect(warning).toContain("chatElements.completedWithWarnings");
  expect(warning).toContain("access_denial_observed");
});
