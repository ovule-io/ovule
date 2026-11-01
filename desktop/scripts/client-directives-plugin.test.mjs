import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "vite";
import { clientDirectives } from "./client-directives-plugin.mjs";

test("browser dependency directives are removed without hiding authored warnings or string values", async () => {
  const root = await mkdtemp(join(tmpdir(), "ovule-client-directives-"));
  try {
    await mkdir(join(root, "node_modules/example"), { recursive: true });
    await writeFile(
      join(root, "node_modules/example/index.js"),
      '/* before prologue */\n"use client";\n"use strict";\nexport const value = "use client";',
    );
    const input = join(root, "entry.js");
    const compile = async (prefix) => {
      await writeFile(
        input,
        `${prefix}import { value } from "./node_modules/example/index.js"; console.log(value);`,
      );
      const warnings = [];
      const result = await build({
        configFile: false,
        root,
        plugins: [clientDirectives()],
        logLevel: "silent",
        build: {
          write: false,
          minify: false,
          rollupOptions: { input, onwarn: (warning) => warnings.push(warning) },
        },
      });
      return {
        warnings,
        code: result.output
          .filter((item) => item.type === "chunk")
          .map((item) => item.code)
          .join("\n"),
      };
    };
    const dependency = await compile("");
    assert.match(dependency.code, /use client/); // Runtime string value is preserved.
    assert.equal(
      dependency.warnings.some((warning) => warning.code === "MODULE_LEVEL_DIRECTIVE"),
      false,
    );
    const authored = await compile('"use client";\n');
    assert.equal(
      authored.warnings.some((warning) => warning.code === "MODULE_LEVEL_DIRECTIVE"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
