# Extension capabilities and Thread message blocks

## 1. Scope

CRD Computer Use、Human handoff/Appshot 和 Ollama setup 属于宿主能力，
声明编译在 `crates/ovule-extension-api/src/host.json`，不再通过空扩展发布。
`io.ovule.host` 是现有 `extensionId` DTO 中的宿主路由标识，不对应安装包、
运行时或扩展生命周期。扩展管理不列出该标识；宿主命名空间不能被安装包覆盖。
`computer-use`、`human-handoff`、`ollama` ID 保持稳定；settings reconciliation
迁移旧 Essentials / CRD 工具归属，并保留禁用状态。旧 Essentials setup 请求仍能解析。
Cloudflare、Office 和可视化等具有独立实现的扩展继续单独维护。
能力分层、可调用性和后续扩展合同见 [Agent harness](ovule-harness.md)。

Ovule extensions can contribute Agents, Models, onboarding/setup surfaces,
Computer Use providers, local file editors, product capabilities, and renderers for typed Thread message
parts. This is the same package format used by bundled Agent and Channel
contributions, but a visual-only extension needs no process,
workspace, network, environment, or secret permission.

The Host contract supports reviewed bundled extensions and explicitly installed
packages under the Ovule data directory. Arbitrary remote modules are not
loaded, and installed packages cannot contribute executable renderer modules.
They may select a bounded Host renderer such as `channel-setup`. A
future third-party marketplace must add signatures, trust/revocation, atomic
generations, and an isolated WebContents boundary before untrusted UI code is
enabled.

Manage exposes an `Install third-party extension` directory picker. Installation
validates the package and complete contribution namespace, copies only
`extension.json`, `dist/`, `skills/`, and `workflows/` into the data directory,
rejects symlinks and executable renderer contributions, and then reconciles the catalog.
Third-party packages can be disabled, re-enabled, or removed from Manage; those
actions are not exposed for built-in Extensions. Optional Agent and Channel integrations live in independent repositories
under the ignored root `plugins/` directory and are not
listed directly in `tuffite.json`.

Onboarding contributions are declarative Host UI, not arbitrary renderer code.
They provide labels, fields, links, Toolchain requirements, status probes, and
bounded setup actions. The trusted Host retains credential, process, network,
installation, and model-catalog ownership.

## 2. Manifest contributions

An extension may add named capabilities and map stable message-part kinds to
custom-element implementations. The following is `extension.json`; standard
npm metadata and build dependencies live separately in `package.json`:

```json
{
  "id": "io.example.visuals",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "schemaVersion": 1,
  "apiVersion": 1,
  "contributes": {
    "capabilities": [
      {
        "id": "visualization.echarts",
        "label": "ECharts visualization",
        "description": "Render declarative chart data."
      }
    ],
    "messageBlocks": [
      {
        "kind": "echarts",
        "tag": "ovule-echarts",
        "module": "dist/web/echarts-block.mjs",
        "style": "dist/web/blocks.css",
        "capability": "visualization.echarts",
        "agentInstructions": "Use this block when the user asks for a chart.",
        "example": {
          "option": {
            "xAxis": { "data": ["A"] },
            "series": [{ "type": "bar", "data": [1] }]
          }
        }
      }
    ]
  },
  "permissions": {}
}
```

Validation fails closed when:

- an ID, version, contribution kind, or custom-element tag is invalid;
- two capabilities or message-block kinds collide in one package;
- a block references an undeclared capability;
- a module is not a package-local `dist/web/*.mjs` file or a style is not a
  package-local `dist/web/*.css` file;
- a path is absolute, traverses a parent, resolves through a symbolic link, or
  escapes the canonical package root;
- a manifest or asset exceeds its configured size limit.

The Utility V8 module graph contains only the self-contained
`dist/extension.mjs` entry and deliberately excludes `dist/web/`. Adapter JavaScript and
renderer JavaScript are different trust/execution surfaces even when they ship in
one package.

`agentInstructions` and `example` make the contribution discoverable to every
conversation Agent. Ovule composes the installed contributions into the
Attempt prompt; the core does not contain chart- or drawing-specific prompt
branches. Workflow-only and structured-goal Attempts do not receive UI block
instructions because they have no assistant Message to own a block.

## 3. Producing a message block

An Agent contribution hook can use the SDK helper:

```js
import { defineAgent, messageBlock, result } from "@ovule/extension";

const adapter = defineAgent({
  prepare(input) {
    /* return SpawnPlan */
  },
  onStdout(state, frame) {
    return result(state, [
      messageBlock("attempt-latency", "echarts", {
        title: "Attempt latency",
        categories: ["Plan", "Run", "Verify"],
        values: [12, 42, 18],
      }),
    ]);
  },
  onStderr(state) {
    return result(state);
  },
  onExit(state) {
    return result(state);
  },
});
```

The normalized event is:

```json
{
  "kind": "message.block",
  "payload": {
    "id": "attempt-latency",
    "kind": "echarts",
    "data": {}
  }
}
```

`id` is stable within the Attempt. Re-emitting the same ID upserts the block, so
a streaming chart or drawing can update without appending duplicate cards. The
payload is JSON and is capped at 256 KiB. Rust accepts only kinds declared by a
validated bundled extension.

Full external CLIs can also return the portable control envelope documented in
the injected prompt:

````markdown
Chart ready.

```ovule-block
{"id":"attempt-latency","kind":"echarts","data":{"option":{"series":[{"type":"bar","data":[12,42,18]}]}}}
```
````

Rust parses this only at the Worker boundary, accepts only registered kinds and
bounded JSON, strips the control fence from user-visible Markdown, and emits the
same typed `WorkerEvent::MessageBlock`. Once a fence begins, its token chunks are
held back so the internal envelope never flashes in the streaming UI. Invalid or
unknown fences remain visible Markdown rather than being silently interpreted.

## 4. Durable and observable path

```text
AgentDriver onStdout/onExit
  -> validated message.block ExtensionEvent
  -> typed WorkerEvent::MessageBlock
  -> Attempt assistant Message part upsert
  -> SQLite snapshot + append-only application event
  -> workspace revision notification
  -> Thread renderer registry
  -> extension Web Component
```

Attempt completion updates only the Markdown part and preserves extension
blocks. Partial and completed blocks therefore survive reload and can coexist
with Markdown, image, file, and link parts. Unknown kinds render a safe fallback
rather than breaking the Thread.

## 5. Web Component contract

The application loads the catalog before React mounts. Each extension receives
its own `CustomElementRegistry` and ShadowRoot. For each contribution it:

1. accepts only same-origin URLs below `/extensions/`;
2. dynamically imports the declared `.mjs`;
3. invokes `registerMessageBlock(registry, runtimeTag)` and verifies that the
   element constructor was registered and the created node was upgraded;
4. loads the optional local `.css` inside the extension ShadowRoot;
5. registers the kind in the Thread message-part renderer registry.

Native Scoped Custom Element Registries are preferred. Ovule creates one
registry and ShadowRoot per Extension and verifies that the resulting node was
actually upgraded, rather than merely checking the tag name. On Chromium
versions whose scoped creation path is incomplete, Ovule derives a
deterministic runtime tag from the Extension ID and declared tag, registers that
unique tag in the global registry, and still renders it inside the extension
ShadowRoot. This fallback does not proxy `window.customElements` and prevents two
extensions from colliding even when they declare the same tag. Message `kind`
remains globally unique because it is the durable SQLite routing key.

The host creates the element and assigns two properties:

```ts
interface OvuleMessageBlockElement extends HTMLElement {
  data: JsonValue;
  streaming: boolean;
}
```

The host does not interpolate block JSON into HTML and does not pass ShellAPI,
secrets, Agent process handles, or persistence APIs. A single module failure is
reported and downgraded to the unknown-part card; it cannot black-screen the
application.

Bundled Web Components currently execute in the trusted application renderer.
Consequently, only reviewed assets shipped in the signed application package may
use this path. Untrusted third-party components must later run in an isolated
WebContents with a narrow message bridge and restrictive CSP.

## 6. Bundled visuals example

`extensions/visuals` combines charts, drawings, generated HTML and file editors:

- `visualization.echarts`: `echarts` -> `<ovule-echarts>`;
- `drawing.excalidraw`: `excalidraw` -> `<ovule-excalidraw>`;
- `interactive-ui`: host-managed sandbox iframe;
- Office file previews and spreadsheet editing: `<ovule-office-editor>`.

The ECharts renderer prebundles the official Apache ECharts `6.1.0` browser
library into the package-local `dist/ui.js` snapshot; it requires neither a CDN nor
Node at runtime and accepts a standard `data.option`. License and notice files
ship beside the extension. The Excalidraw renderer remains a lightweight
Excalidraw-shaped scene example. A future extension can prebundle the full
Excalidraw library without changing the Ovule core.

## 7. Validation evidence

The release test suite covers:

- valid and invalid manifests, remote/path-escaping assets, capability references,
  custom-element tags, and asset size limits;
- SDK manifest validation and `messageBlock()` event construction;
- Agent adapter event conversion to `WorkerEvent::MessageBlock`;
- stable block upsert, Attempt completion preservation, and SQLite reopen;
- Vite `.mjs`/`.css` MIME handling and confined `/extensions/` serving;
- browser registration and rendering of `<ovule-echarts>`, its local style,
  an actual ECharts canvas, and the `Attempt latency` block without console/page
  errors;
- a real Sample ACP request for an ECharts chart producing a persisted `echarts` part
  and canvas while the control fence remains absent from the Thread.

## 8. Computer Use contributions

A Computer Use extension selects either the native CRD backend or an external
stdio MCP backend. The host declaration uses Tuffite's native Chromium
Remote Desktop service and therefore has no Toolchain or child process:

```json
{
  "contributes": {
    "computerUse": [
      {
        "id": "computer-use",
        "label": "CRD Computer Use",
        "provider": "crd",
        "backend": "native-crd",
        "capabilities": [
          "desktop.snapshot",
          "desktop.input",
          "clipboard.write"
        ],
        "agents": ["ovule"]
      }
    ]
  }
}
```

Ovule reconciles this into one host-owned Tool with transport
`native-crd` and target `tuffite.remoting`. Built-in Ovule model providers see
the MCP-shaped `ovule_computer_control` function, but invocation stays
in-process: screenshots use the CRD desktop capturer and input uses the CRD
input injector through the typed Tuffite ABI. No MCP server is spawned and no
desktop-control executable is downloaded. New Ovule profiles created during
onboarding inherit this Tool.

The facade supports screenshot, pointer move/click/down/up, wheel, text, USB HID
key events, and bounded clipboard writes. Native Ovule profiles use the in-process facade. External Agents can use the
authenticated, session-lifetime loopback Streamable HTTP MCP projection; the
HTTP adapter calls the same facade and does not carry desktop video. Third-party extensions may still declare `backend: "mcp-stdio"` with a
Toolchain when they need an external provider, but that path is separate from
the built-in CRD implementation.

## 9. Local file editor contributions

A reviewed extension can add Workbench editors for local Thread-workspace
files:

```json
{
  "contributes": {
    "fileEditors": [
      {
        "id": "office-spreadsheet",
        "label": "Spreadsheet editor",
        "extensions": ["xlsx", "csv"],
        "mode": "editable",
        "threadPresentation": "card",
        "tag": "ovule-office-editor",
        "module": "dist/web/office-editor.mjs",
        "style": "dist/web/office-editor.css"
      }
    ]
  },
  "permissions": { "workspace": true }
}
```

The Workbench host selects the contribution by lowercase file extension, loads
only package-local `/extensions/*/dist/web/*.mjs` and `.css` assets, mounts the registered
custom element in a ShadowRoot, and assigns:

```ts
interface OvuleFileEditorElement extends HTMLElement {
  file: {
    name: string;
    extension: string;
    bytes: Uint8Array;
    readOnly: boolean;
  };
  exportFile?(): Promise<Uint8Array>;
}
```

An editable element emits the bubbling `ovule:file-dirty` event after a user
change. Saving calls `exportFile()` and writes through the bounded ShellAPI; the
extension never receives a native filesystem handle. Relative paths resolve
inside the active Thread workspace. Absolute paths selected by the user or
emitted by an Agent may point elsewhere on the local machine; the trusted root
ShellAPI canonicalizes the exact file and passes only bounded bytes to the
extension. Each file is limited to 12 MiB. The trusted Host additionally
restricts save operations to formats declared editable by the bundled contract.

The bundled `io.ovule.visuals` extension processes files entirely on-device:

- DOCX and DOTX: preview with `docx-preview`;
- XLSX and CSV: preview, cell editing, and local save with `exceljs`;
- XLSM: read-only preview, preserving the rule that macro-enabled files are not
  rewritten;
- PPTX, PPTM, and PPSX: read-only slide preview with `pptxviewjs`;
- PDF: read-only page rendering with the locally bundled `pdfjs-dist`.

`threadPresentation` lets the extension opt supported files into Thread `link`
or `card` rendering. Explicit Markdown links, typed file parts, and bare
absolute paths ending in a contributed extension route into a new Office
Workbench tab. Remote HTTP links continue to route to Browser tabs. Parsing,
rendering, and serialization live in the Visuals extension bundle; the core only
owns catalog lookup, bounded I/O, and tab routing. All third-party libraries and notices are shipped locally,
so preview/edit does not depend on Microsoft 365 or another cloud service.

An empty Computer Use `agents` allowlist exposes the capability to all installed Agents; explicit IDs restrict it to those Agent IDs or drivers. Host capability grants and process permissions still apply.
