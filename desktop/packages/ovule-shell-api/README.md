# Ovule Shell API

`shell_api.mojom` is the source contract (`module ovule`). It defines 73 data
structures and nine process-independent interfaces. `build.rs` generates Rust
traits/dispatchers and the single `generated/index.js` / `index.d.ts` pair.
`build.mojomSources` selects the contract. JavaScript uses camelCase; permissions
use canonical `module.Interface.Method` names, such as `ovule.Workspace.Snapshot`.

The Browser registers its implemented interfaces in `#[tuffite::browser]`.
Shell adapters implement those traits and delegate to domain services. There is
no `generate_handler!`, business global, `/register`, `/schema`, or output mirror.

```ts
import type { AppSnapshot, OvuleApi } from "@ovule/shell-api";
const { workspace, content } = await import("@ovule/shell-api");
const state = await workspace.snapshot();
```

The desktop workspace adapter composes the interfaces for UI consumers.
Framework methods are module exports from `/tuffite.js`; only the native
transport and DOM integrations remain on `globalThis.tuffite`.
Timestamp fields carry Unix milliseconds as numbers. Nullable values may be
`null`; adapters normalize them where DOM APIs require `undefined`.

Run native generation before frontend builds. Vite serves the application module
at `/shell_api.js` and bundles typed imports from this private workspace package.
The code generator owns only the fixed output pair; no JS/TS inventory is needed.

Native smoke: `python scripts/smoke_typed_mojom.py --package dist/ovule-mojom`
from the application root. It narrows only a disposable package's permissions,
checks Rust/C++ typed calls and rejection paths, then exits and restarts with the
same isolated data. Real application profiles and the source manifest are not changed.
