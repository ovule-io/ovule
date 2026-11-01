import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const restriction = (selector, message) => ({ selector, message });
const computedImports = [
  restriction(
    "ImportExpression[source.type!=Literal]",
    "Computed imports belong in the host asset loader.",
  ),
  restriction(
    "CallExpression[callee.name=require] > :not(Literal).arguments",
    "Require must use a literal module path.",
  ),
];
const sameDomain = {
  element: { type: "capability", captured: { domain: "{{ from.element.captured.domain }}" } },
};
const contract = { file: { categories: "contract" } };
const publicImport = { source: "@ovule/**" };
export default [
  { ignores: ["dist/**", "**/node_modules/**"] },
  {
    files: ["src/**/*.{ts,tsx}", "features/*/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "features/*/src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/root-path": root,
      "boundaries/elements": [
        { type: "ownership", pattern: "packages/ovule-ioc-container" },
        { type: "ownership", pattern: "src/**", partialMatch: false },
        { type: "ownership", pattern: "tests/**", partialMatch: false },
        { type: "capability", pattern: "features/*", capture: ["domain"] },
        { type: "library", pattern: "packages/*" },
      ],
      "boundaries/files": [
        { pattern: "**/packages/ovule-ioc/src/bridge.ts", category: "ownership" },
        { pattern: "**/features/*/src/index.ts", category: "barrel" },
        { pattern: "**/*.d.{ts,cts,mts}", category: "contract" },
        { pattern: "**/*.token.ts", category: "token" },
        { pattern: "**/*.provider.ts", category: "provider" },
        { pattern: "src/app/services.ts", category: "composition" },
        { pattern: "src/app/*/*services.ts", category: "composition" },
      ],
      "boundaries/dependency-nodes": ["require", "dynamic-import"],
      "boundaries/additional-dependency-nodes": [
        // Include inline type specifiers as well as `import type` / `export type`.
        {
          selector:
            "ImportDeclaration[importKind=type] > Literal, ImportDeclaration[specifiers.length>0]:not(:has(ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier[importKind!=type])) > Literal",
          kind: "type",
          name: "import",
        },
        {
          selector:
            "ImportDeclaration:not([importKind=type]):has(ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier[importKind!=type]) > Literal, ImportDeclaration[specifiers.length=0] > Literal",
          kind: "value",
          name: "import",
        },
        {
          selector:
            "ExportNamedDeclaration[exportKind=type] > Literal, ExportNamedDeclaration[specifiers.length>0]:not(:has(ExportSpecifier[exportKind!=type])) > Literal, ExportAllDeclaration[exportKind=type] > Literal",
          kind: "type",
          name: "export",
        },
        {
          selector:
            "ExportNamedDeclaration:not([exportKind=type]):has(ExportSpecifier[exportKind!=type]) > Literal, ExportAllDeclaration:not([exportKind=type]) > Literal",
          kind: "value",
          name: "export",
        },
        {
          selector: "TSExternalModuleReference > Literal",
          kind: "value",
          name: "import-equals",
        },
        {
          selector: "TSImportType > TSLiteralType > Literal",
          kind: "type",
          name: "import-type",
        },
      ],
      "import/resolver": {
        typescript: {
          project: [
            path.join(root, "tsconfig.features.json"),
            path.join(root, "tsconfig.app.json"),
          ],
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          extensions: [".ts", ".tsx", ".d.ts", ".js", ".json", ".css"],
        },
      },
    },

    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          checkUnknownLocals: true,
          checkInternals: true,
          policies: [
            // Shared product metadata is data, available to all application layers.
            {
              allow: {
                to: { module: { origin: "local" } },
                dependency: {
                  source: [
                    "../../branding.json",
                    "../../../branding.json",
                    "../../../../branding.json",
                  ],
                },
              },
            },
            {
              allow: {
                to: [
                  { module: { origin: ["external", "core"] } },
                  { element: { type: "library" } },
                ],
              },
            },
            { from: { element: { type: "capability" } }, allow: { to: sameDomain } },
            { allow: { to: { file: { categories: "token" } }, dependency: publicImport } },
            { allow: { to: contract, dependency: { ...publicImport, kind: "type" } } },
            { from: contract, disallow: { to: { module: { origin: "*" } } } },
            {
              from: contract,
              allow: {
                to: [{ ...sameDomain, ...contract }, { module: { origin: "external" } }],
                dependency: { kind: "type" },
              },
            },
            {
              from: contract,
              allow: { to: contract, dependency: { ...publicImport, kind: "type" } },
            },
            {
              disallow: {
                to: { element: { type: "capability" }, ...contract },
                dependency: { kind: "value" },
              },
            },
            {
              from: { element: { type: "capability" } },
              disallow: {
                to: [{ element: { type: "ownership" } }, { file: { categories: "ownership" } }],
              },
            },
            {
              from: { element: { type: "capability" } },
              disallow: {
                to: { module: { source: "@ovule/ioc", internalPath: ["bridge", "src/**"] } },
              },
            },
            {
              from: { element: { type: "capability" } },
              disallow: {
                to: {
                  module: { source: ["@ovule/ioc-container{,/**}", "ovule-desktop{,/**}"] },
                },
              },
            },
            {
              from: { element: { type: "ownership" } },
              allow: { to: { element: { type: "ownership" } } },
            },
            { disallow: { to: { file: { categories: "provider" } } } },
            {
              from: { element: { type: "ownership" }, file: { categories: "composition" } },
              allow: { to: { file: { categories: "provider" } }, dependency: publicImport },
            },
          ],
        },
      ],
      "boundaries/no-unknown-files": "error",
      "no-restricted-syntax": ["error", ...computedImports],
    },
  },
  {
    files: ["features/*/src/**/*.token.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...computedImports,
        restriction(
          "ExportNamedDeclaration, ExportAllDeclaration, TSExportAssignment",
          "Token modules cannot have named exports or re-exports.",
        ),
        restriction(
          "ExportDefaultDeclaration:not([declaration.type=CallExpression][declaration.callee.name=tokens])",
          "Token modules must default-export tokens(...).",
        ),
        restriction(
          "Program:not(:has(ExportDefaultDeclaration))",
          "Token modules require export default tokens(...).",
        ),
      ],
    },
  },
  {
    files: ["features/*/src/**/*.provider.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...computedImports,
        restriction(
          "ExportNamedDeclaration, ExportAllDeclaration, TSExportAssignment",
          "Providers only default-export a registration function.",
        ),
        restriction(
          "ExportDefaultDeclaration:not([declaration.type=FunctionDeclaration])",
          "Providers default-export a synchronous registration function.",
        ),
        restriction(
          "ExportDefaultDeclaration > FunctionDeclaration[async=true], ExportDefaultDeclaration > FunctionDeclaration:not([returnType.typeAnnotation.type=TSVoidKeyword])",
          "Provider registration is synchronous and returns void.",
        ),
        restriction(
          "Program:not(:has(ExportDefaultDeclaration))",
          "Providers require a default registration function.",
        ),
        restriction(
          "Program > ExpressionStatement, ImportDeclaration[specifiers.length=0]",
          "Providers cannot execute module-level side effects.",
        ),
        restriction(
          "Program > VariableDeclaration CallExpression, Program > VariableDeclaration NewExpression",
          "Construct services inside their factory.",
        ),
      ],
    },
  },
  {
    files: ["features/*/src/**/*.d.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...computedImports,
        restriction(
          "VariableDeclaration, FunctionDeclaration, TSDeclareFunction, ClassDeclaration, TSEnumDeclaration, ExportDefaultDeclaration, TSExportAssignment",
          "Declaration contracts only declare types and interfaces.",
        ),
        restriction(
          "ImportDeclaration[importKind!=type]:has(ImportDefaultSpecifier,ImportNamespaceSpecifier,ImportSpecifier[importKind!=type]), ExportAllDeclaration[exportKind!=type]",
          "Contract dependencies must be type-only.",
        ),
      ],
    },
  },
  {
    files: ["features/shell/src/load-external-module.ts"],
    rules: { "no-restricted-syntax": ["error", ...computedImports.slice(1)] },
  },
];
