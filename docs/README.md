# Documentation

Ovule is a local-first desktop workspace for agents, built on Tuffite. Both are
in active development. The pages below describe current contracts and explicitly
identify unimplemented behavior; historical validation runs are not release gates.

## Start here

- [Contributing](../CONTRIBUTING.md): tool setup, formatting, Zed and checks.
- [Local development](local-development.md): native builds, SDK overrides and smoke tests.
- [Open source and distribution](open-source.md): licenses, source export and release checks.
- [Architecture](architecture.md): application composition and capability ownership.
- [Rust architecture](rust-architecture.md): service boundaries, IoC and lifecycle.
- [Product UI](product-ui.md): workbench, panes, conversations and artifacts.
- [Technology selection](technology-selection.md): dependency and reuse decisions.

## Agents and extensions

- [Agents and threads](agents-and-threads.md): profiles, sessions and execution events.
- [Agent harness](ovule-harness.md): capability projections, context, memory and evaluation.
- [Layering and discovery](agent-layering-and-discovery.md): kernel/provider boundaries and lazy tools.
- [Execution permissions](agent-execution-permissions.md): admission, approval and sandbox policy.
- [Goals and workflows](goal-and-workflow.md): scheduling, gates, attempts and recovery.
- [Catalog management](catalog-management.md): Skills, MCP, toolchains, models and Agents.
- [Agent drivers](agent-driver-extensions.md): external driver and authorization contracts.
- [Extension capabilities](extension-capabilities.md): contribution manifests and message blocks.
- [Isolated extension UI](extension-isolated-ui.md): trusted host and guest renderer boundaries.
- [Channels and onboarding](channels-and-onboarding.md): optional adapters, pairing and delivery.
- [Observability](observability.md): events, diagnostics, redaction and retention.

## Hosts and native integration

- [Remote Hosts](remote-host-architecture.md): identity, resources, grants and planned durable Runs.
- [Remote Control](remote-control-architecture.md): session ownership, input, geometry and media.
- [Relay deployment](remote-control-relay-deployment.md): Host-owned TURN policy and validation.
- [Connected apps and handoff](connected-apps-and-human-handoff.md): MCP apps and control handoff.
- [macOS permissions](macos-permissions.md): build identities and system grants.

## Documentation policy

Write documentation in English. Keep operational instructions and current contracts
in these reference pages, with package-specific details beside the implementation.
Merge changes into the owning page rather than adding dated plans, review diaries
or duplicate validation reports. Describe intended behavior as planned until it is
implemented and validated. Keep exact validation evidence with the change or its
artifacts; do not imply an older candidate validates the current source tree.
