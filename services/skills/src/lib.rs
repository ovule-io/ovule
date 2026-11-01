//! Agent Skills metadata → instructions → referenced resources. No execution grants.
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::{
    collections::BTreeMap,
    io::Read as _,
    path::{Component, Path, PathBuf},
};
const MAX_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub revision: String,
    pub compatibility: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SkillRead {
    pub content: String,
    pub revision: String,
    pub offset: usize,
    pub next_offset: Option<usize>,
    pub total_chars: usize,
}
#[derive(Clone, Debug)]
struct Entry {
    metadata: SkillMetadata,
    root: PathBuf,
    path: PathBuf,
}
#[derive(Clone, Debug, Default)]
pub struct SkillCatalog {
    entries: BTreeMap<String, Entry>,
}
#[derive(Deserialize)]
pub struct Frontmatter {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub compatibility: Option<String>,
}
impl SkillCatalog {
    pub fn discover(paths: &[String]) -> Result<Self, String> {
        if paths.len() > 128 {
            return Err("selected skill catalog exceeds 128 entries".into());
        }
        let mut entries = BTreeMap::new();
        for value in paths {
            let path = std::fs::canonicalize(value)
                .map_err(|e| format!("selected Skill is unavailable: {e}"))?;
            if path.file_name().and_then(|s| s.to_str()) != Some("SKILL.md") {
                return Err("selected Skill must be SKILL.md".into());
            }
            let source = read_bounded(&path)?;
            let (metadata, _) = parse(&source)?;
            let revision = digest(&source);
            let id = format!(
                "{}-{}",
                metadata.name,
                &digest(&path.to_string_lossy())[..12]
            );
            let entry = Entry {
                metadata: SkillMetadata {
                    id: id.clone(),
                    name: metadata.name,
                    description: metadata.description,
                    revision,
                    compatibility: metadata.compatibility,
                },
                root: path.parent().ok_or("Skill has no root")?.to_path_buf(),
                path,
            };
            entries.insert(id, entry);
        }
        Ok(Self { entries })
    }
    #[must_use]
    pub fn list(&self) -> Vec<SkillMetadata> {
        self.entries
            .values()
            .map(|entry| entry.metadata.clone())
            .collect()
    }
    pub fn read(
        &self,
        id: &str,
        resource: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<SkillRead, String> {
        let entry = self
            .entries
            .get(id)
            .ok_or("Skill is not selected for this Attempt")?;
        // A discovery revision pins instructions; changing files requires a new Attempt.
        let current = read_bounded(&entry.path)?;
        if digest(&current) != entry.metadata.revision {
            return Err("Skill changed since assembly; start a fresh Attempt".into());
        }
        let source = if let Some(resource) = resource {
            let relative = Path::new(resource);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_)))
            {
                return Err("Skill resource must be a relative path within its root".into());
            }
            let resolved =
                std::fs::canonicalize(entry.root.join(relative)).map_err(|e| e.to_string())?;
            if !resolved.starts_with(&entry.root) {
                return Err("Skill resource escapes its root".into());
            }
            read_bounded(&resolved)?
        } else {
            parse(&current)?.1.to_owned()
        };
        let total = source.chars().count();
        if offset > total {
            return Err("Skill offset exceeds content length".into());
        }
        let count = limit.clamp(1, 12_000);
        let content = source.chars().skip(offset).take(count).collect::<String>();
        let end = offset + content.chars().count();
        Ok(SkillRead {
            revision: digest(&source),
            content,
            offset,
            next_offset: (end < total).then_some(end),
            total_chars: total,
        })
    }
}
pub fn parse(source: &str) -> Result<(Frontmatter, &str), String> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let rest = source
        .strip_prefix("---\n")
        .or_else(|| source.strip_prefix("---\r\n"))
        .ok_or("Skill requires YAML frontmatter")?;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let metadata: Frontmatter =
                serde_yaml_ng::from_str(&rest[..offset]).map_err(|e| e.to_string())?;
            if !valid_name(&metadata.name)
                || metadata.description.trim().is_empty()
                || metadata.description.len() > 1024
                || metadata
                    .compatibility
                    .as_ref()
                    .is_some_and(|s| s.len() > 500)
            {
                return Err("invalid Agent Skills metadata".into());
            }
            return Ok((metadata, &rest[offset + line.len()..]));
        }
        offset += line.len();
        if offset > 16_384 {
            break;
        }
    }
    Err("Skill frontmatter is missing its closing delimiter".into())
}
fn read_bounded(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("Skill resource is not a bounded regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576 {
        return Err("Skill resource exceeds 1 MiB".into());
    }
    String::from_utf8(bytes).map_err(|_| "Skill resource is not UTF-8 text".into())
}
fn digest(source: &str) -> String {
    format!("{:x}", Sha256::digest(source.as_bytes()))
}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub mod capability;
