use ovule_memory::{Access, Memory, MemoryService, Provenance};
fn fact(scope: &str, attempt: &str, key: &str, body: &str) -> Memory {
    Memory {
        scope: scope.into(),
        key: key.into(),
        revision: 0,
        title: "Rust project preference".into(),
        body: body.into(),
        provenance: Provenance {
            attempt_id: attempt.into(),
            source: "user task evidence".into(),
            observed_at_ms: 100,
        },
        expires_at_ms: None,
    }
}
#[test]
fn persists_searches_with_scope_and_compare_and_swap() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("memory.sqlite");
    let access = Access::thread("one", "attempt");
    let other = Access::thread("two", "attempt");
    {
        let service = MemoryService::open(&path).unwrap();
        let saved = service
            .put(
                &access,
                &fact(
                    "thread:one",
                    "attempt",
                    "language",
                    "Prefer Rust and SQLite",
                ),
                0,
                100,
            )
            .unwrap();
        assert_eq!(saved.revision, 1);
        service
            .put(
                &other,
                &fact("thread:two", "attempt", "secret", "Rust private workspace"),
                0,
                100,
            )
            .unwrap();
        assert!(service.put(&access, &saved, 0, 100).is_err());
        assert!(service.get(&access, "thread:two", "secret", 100).is_err());
        let hits = service
            .search(&access, "thread:one", "Rust", 100, 20)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].key, "language");
        assert!(
            service
                .search(&access, "thread:one", "\" OR *", 100, 5)
                .is_ok()
        );
    }
    let service = MemoryService::open(&path).unwrap();
    assert_eq!(
        service
            .get(&access, "thread:one", "language", 100)
            .unwrap()
            .unwrap()
            .revision,
        1
    );
    service
        .delete(&access, "thread:one", "language", 1)
        .unwrap();
    assert!(
        service
            .get(&access, "thread:one", "language", 100)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        service
            .search(&access, "thread:one", "Rust", 100, 5)
            .unwrap()
            .len(),
        0
    );
    assert!(
        service
            .put(
                &access,
                &fact("thread:one", "attempt", "language", "Stale resurrection"),
                0,
                100
            )
            .is_err()
    );
}
#[test]
fn expiry_and_provenance_are_enforced() {
    let service = MemoryService::open(std::path::Path::new(":memory:")).unwrap();
    let access = Access::thread("one", "attempt");
    let mut value = fact("thread:one", "attempt", "temporary", "temporary fact");
    value.expires_at_ms = Some(101);
    service.put(&access, &value, 0, 100).unwrap();
    assert!(
        service
            .get(&access, "thread:one", "temporary", 101)
            .unwrap()
            .is_none()
    );
    value.key = "forged".into();
    value.provenance.attempt_id = "another".into();
    assert!(service.put(&access, &value, 0, 100).is_err());
}
