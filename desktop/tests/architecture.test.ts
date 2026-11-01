import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";
import path from "node:path";
import { validateManifest } from "../scripts/feature-manifest.mjs";

const eslint = new ESLint({ cwd: path.resolve(import.meta.dir, "..") });
async function violations(source: string, filename = "boundary-probe.ts") {
  const [result] = await eslint.lintText(source, {
    filePath: path.resolve(import.meta.dir, "../features/conversation/src", filename),
  });
  return result.messages.filter((message) => message.severity === 2);
}

describe("feature boundaries", () => {
  test("contracts and tokens are the cross-domain surface", async () => {
    expect(await violations('import tokens from "@ovule/workspace/workspace.token";')).toEqual([]);
    expect(
      await violations('import type { WorkspaceService } from "@ovule/workspace/workspace";'),
    ).toEqual([]);
    expect(
      await violations('import { workspaceApi } from "../../workspace/src/workspace-api";'),
    ).not.toEqual([]);
    expect(
      await violations('import tokens from "../../workspace/src/workspace.token";'),
    ).not.toEqual([]);
  });
  test("container, bridge, application and providers belong to composition", async () => {
    for (const source of [
      'import { createRegistry } from "@ovule/ioc-container";',
      'import { currentScope } from "@ovule/ioc/bridge";',
      'import register from "@ovule/workspace/workspace.provider";',
      'import { application } from "../../../src/app/services";',
    ])
      expect(await violations(source)).not.toEqual([]);
  });
  test("contracts cannot import runtime identities", async () => {
    expect(
      await violations('import tokens from "@ovule/workspace/workspace.token";', "probe.d.ts"),
    ).not.toEqual([]);
  });
  test("token module format is enforced by ESLint", async () => {
    expect(await violations("export const hidden = 1;", "probe.token.ts")).not.toEqual([]);
    expect(
      await violations(
        'import { tokens } from "@ovule/ioc"; export default tokens({});',
        "probe.token.ts",
      ),
    ).toEqual([]);
  });
  test("provider construction happens inside the registration function", async () => {
    expect(
      await violations(
        "const value = factory(); export default function register(): void {}",
        "probe.provider.ts",
      ),
    ).not.toEqual([]);
    expect(
      await violations(
        "export default function register(): void { const value = factory(); }",
        "probe.provider.ts",
      ),
    ).toEqual([]);
  });
});

test("package exports cannot expose implementation or container dependencies", () => {
  const manifest = {
    name: "@ovule/example",
    exports: { "./example.token": "./src/example.token.ts", "./view": "./src/View.tsx" },
    dependencies: { "@ovule/ioc-container": "workspace:*" },
  };
  const errors = validateManifest(manifest, { packageRoot: "/fixture", fileExists: () => true });
  expect(errors.some((error: string) => error.includes("illegal export"))).toBe(true);
  expect(errors.some((error: string) => error.includes("forbidden dependency"))).toBe(true);
});
