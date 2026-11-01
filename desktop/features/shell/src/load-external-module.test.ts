import { expect, test } from "bun:test";
import { externalModuleUrl } from "./load-external-module";
test("host modules are confined to framework and extension asset paths", () => {
  const base = "https://app.example/main";
  expect(externalModuleUrl("/tuffite.js", base)).toBe("https://app.example/tuffite.js");
  expect(externalModuleUrl("/extensions/visuals/dist/web/editor.js", base)).toBe(
    "https://app.example/extensions/visuals/dist/web/editor.js",
  );
  expect(externalModuleUrl("ovule://-/plugins/chart/dist/web/index.js", base)).toBe(
    "ovule://-/plugins/chart/dist/web/index.js",
  );
  for (const value of [
    "/src/workspace/implementation.ts",
    "/@fs/workspace.ts",
    "/node_modules/@ovule/workspace/src/index.ts",
    "/extensions/visuals/dist/web/../../../../src/workspace.ts",
  ])
    expect(() => externalModuleUrl(value, base)).toThrow();
});
