# Channels and onboarding

Messaging adapters are optional extensions installed explicitly. The public application bundles Agent and Provider onboarding; an adapter contributes its own channel setup command, workflow, skills, actions and status blocks.

The host connects to the adapter's trusted worker over JSONL-RPC. It owns connection lifecycle, encrypted credentials, paired owner identity, inbound deduplication, thread routing, feedback subscriptions and durable outbox delivery. Platform authorization pages, API clients, permission scopes and transport details belong in the independent adapter repository. The worker protocol is summarized below.

A connection must complete authorization and provisioning, establish transport and pair its owner before accepting owner messages for Agent execution. Connection health alone does not prove that an inbound event or reply was delivered. The setup panel shows authorization, app events, transport, owner pairing, inbound activity, Agent attempts and actual delivery separately.

Channel identity binds to a Thread independently of the selected Agent. Pairing commands are host control traffic and never become Agent turns. A group feed becomes a passive feedback subscription only when an authorized Agent explicitly subscribes it. Sender identity, conversation type and connection ID remain part of the durable routing boundary.

Incoming platform IDs are deduplicated in SQLite. Agent completion queues one durable reply; the outbox tracks retries and delivery acknowledgement. Partial progress can update an existing progress message, while final output and delivery state remain durable across restarts. Degraded but usable transport can still drain the outbox.

Onboarding and workflow UI use extension contributions rather than hardcoded provider buttons. Channel registration and refresh actions target the shared `channel` host namespace. The adapter supplies the worker plan and region. `hostRenderer: "channel-setup"` selects the trusted generic renderer; its status block kind is `channel-setup`. Secrets are never renderer payloads or conversation messages.

The existing native bridge hosts multiple connections for one adapter namespace. Simultaneous unrelated adapters need provider-qualified connection and worker resolution before they can share that bridge. Public tests use synthetic ACP and Channel fixtures; private account validation and integration diagnostics belong in the private adapter repository.

## Worker and package contract

The trusted worker declares the `channel` namespace. Its `setup()` returns a
JSONL-RPC worker plan. Requests are `startRegistration`, `configure`, `provision`,
`checkProvisioning`, `connect`, `status`, `send`, `sendProgress`, `updateProgress`
and `shutdown`. Keep provider SDKs, endpoints, authorization scopes and diagnostic
scripts in the independent adapter repository.

Use `@ovule/extension/build` to bundle source with input-based license notices;
`OVULE_EXTENSION_SDK` selects an explicit development SDK. Root `plugins/`
repositories are optional and excluded from Git, workspaces and packaging. Never
add private repository URLs as public submodules. See [source publication](open-source.md).

Run `bun run test:fixtures` from `desktop/` before Rust extension-package tests.
Public fixtures contain synthetic adapters without provider SDKs or account access.
