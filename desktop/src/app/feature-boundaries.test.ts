import { expect, test } from "bun:test";
import { ESLint } from "eslint";
import path from "node:path";
const eslint = new ESLint({ cwd: path.resolve(import.meta.dir, "../..") });
async function check(source: string, file = "src/app/root.tsx") {
  const [result] = await eslint.lintText(source, {
    filePath: path.resolve(import.meta.dir, "../..", file),
  });
  return result.messages.filter((message) => message.severity === 2);
}
test("desktop uses contracts and tokens; composition chooses providers", async () => {
  expect(await check('import type {WorkspaceService} from "@ovule/workspace/workspace";')).toEqual(
    [],
  );
  expect(await check('import tokens from "@ovule/workspace/workspace.token";')).toEqual([]);
  expect(
    await check(
      'import register from "@ovule/workspace/workspace.provider";',
      "src/app/services.ts",
    ),
  ).toEqual([]);
  expect(await check('import register from "@ovule/workspace/workspace.provider";')).not.toEqual(
    [],
  );
  expect(await check('import {WorkspaceService} from "@ovule/workspace/workspace";')).not.toEqual(
    [],
  );
});
test("desktop cannot reach a feature implementation or relative token", async () => {
  for (const source of [
    'import {workspaceApi} from "../../features/workspace/src/native-adapter";',
    'import tokens from "../../features/workspace/src/workspace.token";',
    'export * from "../../features/workspace/src/native-adapter";',
    'const module=import("../../features/workspace/src/native-adapter");',
    'const module=require("../../features/workspace/src/native-adapter");',
  ])
    expect(await check(source, "src/app/services.ts")).not.toEqual([]);
});
