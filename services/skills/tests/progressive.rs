use ovule_skills::SkillCatalog;
#[test]
fn metadata_activation_resources_and_revision_are_separate() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("SKILL.md");
    std::fs::write(&path,"---\nname: review\ndescription: Review code.\n---\nPRIVATE_BODY_测试\nSee references/check.md").unwrap();
    std::fs::create_dir(root.path().join("references")).unwrap();
    std::fs::write(
        root.path().join("references/check.md"),
        "ON_DEMAND_RESOURCE",
    )
    .unwrap();
    let catalog = SkillCatalog::discover(&[path.to_string_lossy().into_owned()]).unwrap();
    let metadata = catalog.list();
    assert!(!metadata[0].description.contains("PRIVATE_BODY"));
    let first = catalog.read(&metadata[0].id, None, 0, 5).unwrap();
    let second = catalog
        .read(&metadata[0].id, None, first.next_offset.unwrap(), 12000)
        .unwrap();
    assert!(format!("{}{}", first.content, second.content).contains("PRIVATE_BODY_测试"));
    assert_eq!(
        catalog
            .read(&metadata[0].id, Some("references/check.md"), 0, 100)
            .unwrap()
            .content,
        "ON_DEMAND_RESOURCE"
    );
    assert!(
        catalog
            .read(&metadata[0].id, Some("../outside"), 0, 100)
            .is_err()
    );
    assert!(catalog.read("not-selected", None, 0, 100).is_err());
    std::fs::write(&path, "changed").unwrap();
    assert!(
        catalog
            .read(&metadata[0].id, None, 0, 100)
            .unwrap_err()
            .contains("changed")
    );
}
#[cfg(unix)]
#[test]
fn resources_do_not_follow_symlinks_outside_the_skill() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let path = root.path().join("SKILL.md");
    std::fs::write(&path, "---\nname: check\ndescription: Check.\n---\nSafe").unwrap();
    std::fs::write(outside.path().join("secret"), "forbidden").unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("escape")).unwrap();
    let catalog = SkillCatalog::discover(&[path.to_string_lossy().into_owned()]).unwrap();
    assert!(
        catalog
            .read(&catalog.list()[0].id, Some("escape"), 0, 10)
            .is_err()
    );
}
#[test]
fn invalid_and_unterminated_headers_fail_discovery() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("SKILL.md");
    for source in [
        "no header",
        "---\nname: bad\ndescription: body",
        "---\nname: x\ndescription: ''\n---\nbody",
    ] {
        std::fs::write(&path, source).unwrap();
        assert!(SkillCatalog::discover(&[path.to_string_lossy().into_owned()]).is_err());
    }
}
