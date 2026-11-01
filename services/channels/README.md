# Channels

The host owns pairing, durable inbox/outbox delivery, and Thread routing. Independently installed extensions provide channel transports and declarative actions.

A bot connection may persist an explicit Thread destination in `channel_thread_targets`. It takes precedence over automatic conversation bindings and feed-only subscriptions for future inbound owner messages. Clearing it restores the previous per-conversation behavior. The destination is validated against the current workspace; routing to a deleted destination fails rather than silently creating a Thread. Duplicate platform messages remain deduplicated before any routing decision. Agent replies retain their originating platform conversation and message identity.

`channel.thread.bind` is an extension-declared host action. Its optional `threadId` is supplied by the message card; an empty value removes the override. The card receives Thread choices from an injected conversation read model. Services do not receive an IoC registry.

To restore an independent extension from a local package directory, run the same validator used by Manage:

```sh
cargo run --locked -p ovule-extensions --example install-extension -- /absolute/path/to/extension
```

Restart the application after installing a package with new host action contracts. Installing a package does not import credentials or modify existing channel configuration.

Channel setup and refresh commands enqueue network work and return the current pending state immediately. The serial ShellAPI dispatcher must never wait for the channel worker. Setup cards poll the declared `channel.status.read` action while an operation is pending; reading status performs no network work. Worker failures update the connection state so the card can show the error and allow retry.

A pending authorization session does not yet have a saved connection record. Refresh still queues work for that runtime and invokes the worker's `refreshRegistration` operation, which checks the same device code. A status read remains passive. Once credentials arrive, the Host persists them and marks the Bot configured before provisioning events or connecting its WebSocket. Those subsequent stages can fail independently of authorization. Pending registration and provisioning remain observable through status polling; only configured Bots enable the card's connection selector.


Saved connections can be restored after the worker exits: Refresh starts a fresh
worker, verifies provisioning, configures the saved credentials, and reconnects
without replacing the paired owner or destination Thread. Pending request and
in-flight delivery tracking belong to the worker generation; EOF rejects waiters
immediately instead of holding the command queue until its network timeout.
Startup restoration retries an unavailable Framework Utility boundary with a
bounded backoff on the channel thread. It does not retry rejected authorization.
