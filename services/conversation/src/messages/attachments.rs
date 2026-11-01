use std::path::{Path, PathBuf};

use sha2::{Digest as _, Sha256};

use crate::state::LocalImageAttachment;

use super::MessageError;

const MAX_MESSAGE_IMAGES: usize = 4;
const MAX_MESSAGE_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_TOTAL_BYTES: usize = 12 * 1024 * 1024;

use super::ImageAttachment;

pub(crate) struct MessageAttachmentStore {
    root: PathBuf,
}

impl MessageAttachmentStore {
    pub(crate) fn new(data_root: &Path) -> Self {
        Self {
            root: data_root.join("attachments"),
        }
    }

    pub(crate) fn persist(
        &self,
        attachments: &[ImageAttachment],
    ) -> Result<Vec<LocalImageAttachment>, MessageError> {
        validate_attachment_set(attachments)?;
        std::fs::create_dir_all(&self.root).map_err(|error| {
            MessageError::Persistence(format!("create attachment directory: {error}"))
        })?;
        attachments
            .iter()
            .map(|attachment| self.persist_one(attachment))
            .collect()
    }

    pub(crate) fn read(&self, attachment_id: &str) -> Result<Vec<u8>, MessageError> {
        let path = self.path(attachment_id)?;
        std::fs::read(path)
            .map_err(|error| MessageError::Persistence(format!("read message attachment: {error}")))
    }

    fn persist_one(
        &self,
        attachment: &ImageAttachment,
    ) -> Result<LocalImageAttachment, MessageError> {
        let (media_type, extension) =
            validated_image_type(&attachment.media_type, &attachment.bytes)?;
        let digest = format!("{:x}", Sha256::digest(&attachment.bytes));
        let id = format!("{digest}.{extension}");
        let path = self.root.join(&id);
        if !path.exists() {
            let temporary = self.root.join(format!(".{id}.{}.tmp", std::process::id()));
            std::fs::write(&temporary, &attachment.bytes).map_err(|error| {
                MessageError::Persistence(format!("write message attachment: {error}"))
            })?;
            if let Err(error) = std::fs::rename(&temporary, &path) {
                let _ = std::fs::remove_file(&temporary);
                if !path.exists() {
                    return Err(MessageError::Persistence(format!(
                        "commit message attachment: {error}"
                    )));
                }
            }
        }
        let name = Path::new(attachment.name.trim())
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("pasted-image")
            .chars()
            .take(255)
            .collect();
        Ok(LocalImageAttachment {
            id,
            name,
            media_type: media_type.to_owned(),
            size_bytes: i64::try_from(attachment.bytes.len()).unwrap_or(i64::MAX),
            path: crate::state::external_path(&path),
        })
    }

    fn path(&self, attachment_id: &str) -> Result<PathBuf, MessageError> {
        let valid = attachment_id.len() >= 68
            && attachment_id.len() <= 69
            && attachment_id
                .split_once('.')
                .is_some_and(|(digest, extension)| {
                    digest.len() == 64
                        && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
                        && matches!(extension, "png" | "jpg" | "gif" | "webp")
                });
        if !valid {
            return Err(MessageError::InvalidArgument(
                "invalid attachment ID".to_owned(),
            ));
        }
        Ok(self.root.join(attachment_id))
    }
}

fn validate_attachment_set(attachments: &[ImageAttachment]) -> Result<(), MessageError> {
    if attachments.is_empty() {
        return Err(MessageError::InvalidArgument(
            "at least one image attachment is required".to_owned(),
        ));
    }
    if attachments.len() > MAX_MESSAGE_IMAGES {
        return Err(MessageError::InvalidArgument(format!(
            "at most {MAX_MESSAGE_IMAGES} image attachments are allowed"
        )));
    }
    let total_bytes = attachments.iter().try_fold(0usize, |total, attachment| {
        if attachment.bytes.is_empty() {
            return Err(MessageError::InvalidArgument(
                "image attachment must not be empty".to_owned(),
            ));
        }
        if attachment.bytes.len() > MAX_MESSAGE_IMAGE_BYTES {
            return Err(MessageError::InvalidArgument(format!(
                "each image attachment must be at most {} MiB",
                MAX_MESSAGE_IMAGE_BYTES / 1024 / 1024
            )));
        }
        total.checked_add(attachment.bytes.len()).ok_or_else(|| {
            MessageError::InvalidArgument("image attachments are too large".to_owned())
        })
    })?;
    if total_bytes > MAX_MESSAGE_IMAGE_TOTAL_BYTES {
        return Err(MessageError::InvalidArgument(format!(
            "image attachments must total at most {} MiB",
            MAX_MESSAGE_IMAGE_TOTAL_BYTES / 1024 / 1024
        )));
    }
    Ok(())
}

fn validated_image_type(
    media_type: &str,
    bytes: &[u8],
) -> Result<(&'static str, &'static str), MessageError> {
    let valid = match media_type.trim().to_ascii_lowercase().as_str() {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Some(("image/png", "png")),
        "image/jpeg" if bytes.starts_with(b"\xff\xd8\xff") => Some(("image/jpeg", "jpg")),
        "image/gif" if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => {
            Some(("image/gif", "gif"))
        }
        "image/webp" if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            Some(("image/webp", "webp"))
        }
        _ => None,
    };
    valid.ok_or_else(|| {
        MessageError::InvalidArgument(
            "attachment must be a valid PNG, JPEG, GIF, or WebP image".to_owned(),
        )
    })
}

impl super::AttachmentRepository for MessageAttachmentStore {
    fn persist(
        &self,
        attachments: &[ImageAttachment],
    ) -> Result<Vec<LocalImageAttachment>, MessageError> {
        Self::persist(self, attachments)
    }
    fn persist_output(
        &self,
        image: &ImageAttachment,
    ) -> Result<Vec<LocalImageAttachment>, MessageError> {
        if image.bytes.is_empty() || image.bytes.len() > 12 * 1024 * 1024 {
            return Err(MessageError::InvalidArgument(
                "Agent image must be between 1 byte and 12 MiB".into(),
            ));
        }
        std::fs::create_dir_all(&self.root)
            .map_err(|error| MessageError::Persistence(error.to_string()))?;
        Ok(vec![self.persist_one(image)?])
    }
    fn read(&self, id: &str) -> Result<Vec<u8>, MessageError> {
        Self::read(self, id)
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn validates_and_round_trips_content_addressed_images() {
        let directory = tempdir().unwrap();
        let store = MessageAttachmentStore::new(directory.path());
        let bytes = b"\x89PNG\r\n\x1a\nbytes".to_vec();
        let persisted = store
            .persist(&[ImageAttachment {
                name: "pasted.png".to_owned(),
                media_type: "image/png".to_owned(),
                bytes: bytes.clone(),
            }])
            .unwrap();

        assert_eq!(persisted.len(), 1);
        assert_eq!(store.read(&persisted[0].id).unwrap(), bytes);
        assert!(store.read("../secret.png").is_err());
    }
}
