# Skills, MCP Tools, Toolchains, Models, and Agents

## 1. Purpose and boundary

Ovule manages four related registries without turning the workflow core into
an agent framework. A `Task` stores only an Agent profile ID. Immediately before
dispatch, the profile is resolved into an immutable Attempt execution spec:

```text
Agent profile
  -> AgentDriver contributed by an extension (plus the built-in Ovule worker)
  -> optional provider-native Model ID
  -> enabled Agent Skills
  -> healthy MCP Tools
  -> profile instructions
  -> AttemptSpec
```

The resolved spec is handed to the AgentDriver. Goal and Workflow code does not
depend on MCP, model-provider, or CLI-specific types. Registry mutations use the
same SQLite snapshot plus append-only event transaction as workflow mutations.

## 2. Community-first decisions

### Agent Skills

The import format is the open Agent Skills directory convention: a directory
containing `SKILL.md`, optionally accompanied by `scripts/`, `references/`, and
`assets/`. Ovule validates the required YAML frontmatter rather than inventing
a private skill schema. The current import checks include:

- the file is named `SKILL.md`;
- `name` is 1-64 lowercase ASCII letters, digits, or hyphens, without leading,
  trailing, or consecutive hyphens;
- `name` matches the parent directory;
- `description` is non-empty and at most 1024 bytes;
- the manifest is at most 1 MiB and is valid UTF-8/YAML.

The community `agentx-adk-skill` parser was evaluated but its current MSRV is
1.95, above this workspace's Rust 1.91. Ovule therefore uses `serde_yaml_ng`
for a deliberately small compatibility layer. This decision should be revisited
when a maintained standards parser supports the workspace toolchain.

Skills remain at their source path. An Agent profile references Skill IDs. For
external ACP Agents, the Driver passes `skills.config` overrides and also includes the
selected `SKILL.md` paths in the execution instructions. This keeps discovery
explicit and works with complete external CLIs rather than reimplementing their
skill loaders.

### Tools

The managed unit is an MCP server, not an individual ad-hoc function. Ovule
supports the protocol's two production transports:

- `stdio`: executable plus an ordered argument vector;
- `http`: an `http` or `https` Streamable HTTP endpoint.

The official `modelcontextprotocol/rust-sdk` (`rmcp`) is the client for built-in
Ovule model providers. External CLI Agents continue to delegate protocol
execution to their full CLI:

| Driver   | Per-Attempt tool binding           | Current boundary                                        |
| -------- | ---------------------------------- | ------------------------------------------------------- |
| Codex    | `mcp_servers` config overrides     | stdio/HTTP, required flag, env reference                |
| Sample ACP    | `mcp_servers` config overrides     | same configuration surface                              |
| Claude   | generated temporary `--mcp-config` | stdio/HTTP; credential-reference injection fails closed |
| Ovule | official `rmcp` client per Attempt | stdio; isolated child, discovery/call timeout and output limits |

The built-in bridge is shared by DeepSeek and Ollama's OpenAI-compatible HTTP
runtimes. It starts only enabled, healthy Tools selected by the Agent profile;
onboarding-created Ovule profiles inherit the built-in profile's selected
Tools. Each Attempt owns its MCP child processes and kills them on teardown.
HTTP transport and credential references currently fail closed in the built-in
runtime while the external CLI adapters retain their documented transport
support.

`credentialEnv` stores only an environment-variable name. Ovule never stores
the secret value in SQLite, events, snapshots, logs, or the renderer. HTTP URLs
with embedded credentials are rejected. A required unhealthy Tool makes its Agent
unavailable; an optional unhealthy Tool is omitted from that Attempt.

### Toolchains

Toolchains are local runtimes and CLIs used by Agents and Skills; they are not
model-facing MCP servers. The core registry contains only shared runtimes such
as Node.js, Python, and Ollama. Agent/Channel-specific definitions belong to
their owning Extension: `agent-codex` contributes `codex` and `codex-acp`,
`agent-sample` contributes the externally managed `sample` CLI, and `channel-sample`
contributes `channel-cli`. The built-in Computer Use Extension declares a
`native-crd` capability and does not contribute a Toolchain: capture and input
are provided by the Tuffite binary's linked Chromium Remote Desktop backend.
Entries declare a generic provider, executable candidates, known system
locations, dependencies, and an exact pinned version.

The implementation follows mise's useful deployment semantics without shipping
the full mise binary or coupling to its private CLI internals:

- external tools are discovered read-only and are never installed or upgraded;
- managed tools live under the Ovule data directory;
- the generic `npm` provider accepts registry entries rather than tool-specific
  Rust branches;
- npm package versions and registry origins are exact, lifecycle scripts are
  disabled by default, and package-lock SHA-512 integrity is checked before
  atomically activating a staging directory;
- the generic `archive` provider accepts ZIP and tar.gz payloads, downloads an exact HTTPS URL, enforces the
  declared size and SHA-256, rejects path traversal and symbolic links, bounds
  file count and extracted bytes, and atomically activates the staging tree;
- npm config/cache and installed files stay below the Ovule toolchain root;
- managed bin directories are prepended only to Ovule-owned Agent/Terminal
  child-process environments, never to the user or system `PATH`.

The deterministic native smoke verifies that the Computer Use contribution has
no external Toolchain and that DeepSeek and Ollama can call the built-in
`ovule_computer_control` facade. For a manual product check, select a
Ovule Agent profile that includes `computer-use` and ask it to take a desktop
screenshot. The Attempt should return CRD-captured image content without
starting a child MCP process. OS screen-recording/accessibility prompts still
require normal user approval on macOS.

The full mise executable was rejected for embedding because the installed
Windows binary is about 104 MB, and the published root `mise` crate is a binary
crate rather than an installation SDK. Its published `aqua-registry` and
`mise-sigstore` libraries remain candidates for a future verified archive
provider. `proto_core` was also reviewed: it exposes a real reusable install
API and supports `npm:<package>`, but its Warpgate/Extism plugin runtime is too
large for the current thin provider. Ovule therefore does not depend on or
claim compatibility with proto.

### Models

Models are aliases over provider-native IDs. The persisted record contains an
internal ID, label, provider, remote ID, enabled state, and explicit
`agentIds: string[]` compatibility. There is no provider-name switch in the UI:
users can bind a custom Model to any registered AgentDriver, including multiple
Drivers. The selected Driver passes the remote ID through its documented model
surface.

An extension can contribute Models alongside or independently from Agents.
Extension-owned model metadata is reconciled from the manifest on startup and is
immutable in the user catalog; users can enable or disable it, but cannot rename,
retarget, or delete it. Cross-package Agent references are resolved only after
the whole extension catalog is loaded, and missing or duplicate IDs fail closed.

The bundled `io.ovule.provider.deepseek` package contributes
`deepseek-flash` / `deepseek-v4-pro` as bootstrap Models for the built-in
Ovule Agent. After authentication, `GET https://api.deepseek.com/models` is
the catalog source of truth; newly returned model IDs are persisted and can be
executed without changing the Extension bundle.
DeepSeek is a ModelProvider, not an AgentDriver. The Host bridges the complete
`async-openai` Chat Completions client with `https://api.deepseek.com`. Rust
verifies `DEEPSEEK_API_KEY` exists and injects it only into the Host-owned HTTP
client; the value is never serialized into extension JavaScript input/output,
Catalog state, child-process environment, or events.

`models.dev/api.json` may later enrich discovered models with capabilities,
context windows, and indicative pricing. That metadata is remote and mutable;
the authenticated provider response and Host catalog remain authoritative for
execution.

Ollama is also discovered live through its local `/api/tags` API. Ovule uses
the resolved system or privately managed executable, starts a private service
only when needed, keeps private model storage below the Ovule data root, and
pulls models as observable cancellable background Jobs. An external Ollama
service retains its existing user model directory. Ollama turns use its
OpenAI-compatible `/v1/chat/completions` endpoint so streaming and MCP tool
calls share the same bounded native provider loop as DeepSeek. Output is
forwarded as UTF-8-safe raw chunks, so Markdown begins rendering before a line or
the whole response completes.

### Agents

An Agent is a user-facing profile. It binds a Driver, optional Model, Skills, MCP
Tools, instructions, and enabled state. Extension-owned profiles (`codex`,
`sample`) and the built-in `ovule` profile may be
configured/disabled but not deleted while their package is installed. Their contributed identity (ID, label, and
Driver) is immutable. Custom profiles may
be deleted only when no Thread or Task references them. The same reference check
prevents deleting a Model, Skill, or Tool still attached to an Agent.

## 3. Execution and failure semantics

1. Delegation resolves the selected Agent and validates all references.
2. Ovule persists `attempt/created`.
3. The Agent runtime validates/builds the complete command and registers a
   cancellation token.
4. Ovule persists `attempt/dispatched`.
5. A bounded scheduler admits at most four Workers.
6. The process is started in processkit containment, then `attempt/started` is
   persisted.
7. A two-hour wall deadline, fifteen-minute output-inactivity deadline, and
   512 KiB/2000-line capture bound apply. Cancellation and drop terminate the
   process tree.
8. The terminal transition and summary are committed before the UI event is
   emitted.

Codex and Sample ACP final messages are read from their `--output-last-message` file;
their JSONL stdout remains diagnostic/event material. Claude's JSON result field
is extracted. Missing executables, invalid configuration, unsupported mappings,
non-zero exits, timeout, cancellation, and restart recovery remain distinct
observable outcomes.

## 4. Security and production follow-ups

Implemented now:

- validated IDs, lengths, transports, URLs, Skill manifests, and references;
- no shell interpolation: executables and arguments are passed separately;
- no plaintext credential values in the registry;
- atomic persistence and append-only mutation events;
- bounded concurrent processes, output, wall time, and inactivity;
- process-tree teardown through `processkit`;
- version-pinned, integrity-checked, application-private Toolchain installation;
- fail-closed required Tool and unsupported Driver behavior.

Required before a public production release:

- persistent preflight `rmcp` health probes and OAuth login UX;
- native keyring-backed credential creation, rotation, and deletion;
- signed Skill/extension install flow with provenance, trust review, and immutable
  copied versions rather than arbitrary mutable paths;
- models.dev catalog sync with cache signature/provenance and offline fallback;
- per-Agent permission policy and MCP tool allow/deny lists;
- adapter compatibility fixtures for every supported CLI release;
- audit export with redaction tests.

## 5. References

- Agent Skills specification: <https://agentskills.io/specification>
- Agent Skills client integration: <https://agentskills.io/client-implementation/adding-skills-support>
- Official MCP Rust SDK: <https://github.com/modelcontextprotocol/rust-sdk>
- MCP documentation: <https://modelcontextprotocol.io/docs/>
- models.dev catalog: <https://github.com/steebchen/models.dev>
- Codex non-interactive mode: <https://learn.chatgpt.com/docs/non-interactive-mode.md>
- Claude Code CLI reference: <https://code.claude.com/docs/en/cli-reference>

## Settings surface

Settings is a Framework page rather than a dialog. General contains language
and theme preferences, both defaulting to Follow system. Agent, model, skill,
tool, toolchain, extension, and Host configuration remain sections of Settings.
The chat sidebar no longer owns appearance preferences. Setup also renders as
a Framework page, with its loading boundary confined to that page.

Settings navigation resolves section views through `SettingsSectionsToken`; each section also has its own replaceable view token. General, Hosts, Agents, Models, Skills, Tools, Toolchains, and Extensions live in separate features. Models resolves `OllamaSetupViewToken`. Shared Settings forms/cards live in `components/settings`, and catalog model helpers live in `services/catalog`.

Hosts view state belongs to the main route's IOC scope, so successful Link resets remain hidden across section remounts without leaking to another app graph. Notices remain keyed to the affected legacy records or Host identity; a new identity or different records can show a new notice.

Bundled translation resources live in `src/app/locales/en.json` and `zh-CN.json`; `i18n.ts` only initializes i18next. UI labels and action feedback use keys with interpolation/pluralization. The JSON bundles can later be replaced by an i18next resource backend without changing the views. Vite pre-optimizes lazy-feature dependencies before the first feature click to avoid optimizer-triggered document reloads.
