//! Read-only local Explorer access, independent of a conversation workspace.
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

pub struct PreviewFile {
    pub name: String,
    pub extension: String,
    pub bytes: Vec<u8>,
}

pub fn read_file(path: &Path) -> Result<PreviewFile, String> {
    if !path.is_absolute() {
        return Err("Local file path must be absolute".into());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Local preview requires a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Local file preview exceeds 16 MiB".into());
    }
    let mut extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if extension == "doc" {
        bytes = convert_word(path)?;
        extension = "docx".into();
    }
    Ok(PreviewFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        extension,
        bytes,
    })
}

#[cfg(target_os = "macos")]
fn convert_word(path: &Path) -> Result<Vec<u8>, String> {
    // Read the legacy Word document without altering the source or loading
    // linked external resources. Only converted bytes go to the renderer.
    let output = std::process::Command::new("/usr/bin/textutil")
        .args(["-convert", "docx", "-stdout", "-noload", "-nostore", "--"])
        .arg(path)
        .output()
        .map_err(|e| format!("Convert legacy Word document: {e}"))?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err(format!(
            "Convert legacy Word document: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if output.stdout.len() as u64 > MAX_FILE_BYTES {
        return Err("Converted Word preview exceeds 16 MiB".into());
    }
    Ok(output.stdout)
}

#[cfg(not(target_os = "macos"))]
fn convert_word(_path: &Path) -> Result<Vec<u8>, String> {
    Err("Legacy .doc preview requires conversion to .docx on this platform".into())
}

pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub is_directory: bool,
}

pub fn read_text(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("Local file path must be absolute".into());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Local preview requires a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err("Local text preview exceeds 2 MiB".into());
    }
    if bytes.contains(&0) {
        return Err("Binary files cannot be previewed as text".into());
    }
    String::from_utf8(bytes).map_err(|_| "Local text preview requires UTF-8".into())
}

pub fn list_directory(path: &Path) -> Result<Vec<Entry>, String> {
    if !path.is_absolute() {
        return Err("Local directory path must be absolute".into());
    }
    let mut entries = Vec::new();
    for row in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let row = row.map_err(|e| e.to_string())?;
        if entries.len() == MAX_ENTRIES {
            return Err("Directory exceeds 10000 entries".into());
        }
        entries.push(Entry {
            name: row.file_name().to_string_lossy().into_owned(),
            path: row.path(),
            is_directory: row.path().is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binary_office_bytes_are_read_without_text_decoding() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("report.XLSX");
        let data = [80, 75, 0, 255, 127];
        std::fs::write(&path, data).unwrap();
        let file = read_file(&path).unwrap();
        assert_eq!(file.extension, "xlsx");
        assert_eq!(file.bytes, data);
        assert!(read_file(root.path()).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn legacy_word_is_converted_without_modifying_source() {
        let root = tempfile::tempdir().unwrap();
        let rtf = root.path().join("source.rtf");
        let doc = root.path().join("legacy.doc");
        std::fs::write(&rtf, r"{\rtf1\ansi Legacy Word preview}").unwrap();
        let status = std::process::Command::new("/usr/bin/textutil")
            .args(["-convert", "doc", "-output"])
            .arg(&doc)
            .arg(&rtf)
            .status()
            .unwrap();
        assert!(status.success());
        let original = std::fs::read(&doc).unwrap();
        let converted = read_file(&doc).unwrap();
        assert_eq!(converted.name, "legacy.doc");
        assert_eq!(converted.extension, "docx");
        assert!(converted.bytes.starts_with(b"PK"));
        assert_eq!(std::fs::read(&doc).unwrap(), original);
    }
    #[test]
    fn yaml_is_text_and_listing_keeps_folders_first() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("z-folder")).unwrap();
        let yaml = root.path().join("a #配置.yaml");
        std::fs::write(&yaml, "name: test\nenabled: true\n").unwrap();
        assert_eq!(read_text(&yaml).unwrap(), "name: test\nenabled: true\n");
        let rows = list_directory(root.path()).unwrap();
        assert!(rows[0].is_directory);
        assert_eq!(rows[1].path, yaml);
    }
    #[test]
    fn rejects_non_files_binary_and_oversized_text() {
        let root = tempfile::tempdir().unwrap();
        assert!(read_text(root.path()).is_err());
        assert!(read_text(Path::new("relative.yaml")).is_err());
        let file = root.path().join("binary.yaml");
        std::fs::write(&file, [0, 1, 2]).unwrap();
        assert!(read_text(&file).is_err());
        std::fs::write(&file, vec![b'a'; MAX_TEXT_BYTES as usize + 1]).unwrap();
        assert!(read_text(&file).is_err());
    }
}
