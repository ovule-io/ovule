# Storage

`ovule-storage` owns SQLite checkpoints, revision events, channel inbox
idempotency and the delivery outbox. It depends on serialization and SQLite,
without importing business services, the application or the IoC container.

`Store<S>` accepts a consumer-owned `Checkpoint`: the serialized durable document
and its revision. Workspace implements that capability on its own model and
adapts the store to its repository port. Storage does not interpret conversation,
workflow, host or settings transitions.

A mutation writes the checkpoint and its event in one transaction. Channel
completion may enqueue a reply in that same transaction. The consumer publishes
its candidate state only after commit succeeds; failed commits leave both live
state and durable state unchanged. Channel identities and deduplication keys
remain stable across retries and restart.

The extraction retains schema version 5, SQL table names and the existing flat
checkpoint JSON shape. Existing databases do not need a migration or reset.
Opening an incompatible schema continues to require an explicit reset rather than
silently deleting data. Database handles are owned by the session repository and
are not exposed to ordinary domain services.

```sh
cargo test -p ovule-storage
cargo test -p ovule-workspace storage::tests
```
