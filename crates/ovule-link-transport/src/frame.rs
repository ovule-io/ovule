//! Length-prefixed control frames. Streaming process data has its own envelope.
use crate::LinkError;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub async fn read_frame(reader: &mut (impl AsyncRead + Unpin)) -> Result<Vec<u8>, LinkError> {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let length = reader.read_u32().await.map_err(io)? as usize;
        if length > ovule_link_protocol::MAX_FRAME {
            return Err(LinkError::Protocol("Link frame exceeds limit".into()));
        }
        let mut bytes = vec![0; length];
        reader.read_exact(&mut bytes).await.map_err(io)?;
        Ok(bytes)
    })
    .await
    .map_err(|_| LinkError::Unavailable("Link frame deadline exceeded".into()))?
}
pub async fn write_frame(
    writer: &mut (impl AsyncWrite + Unpin),
    bytes: &[u8],
) -> Result<(), LinkError> {
    if bytes.len() > ovule_link_protocol::MAX_FRAME {
        return Err(LinkError::Protocol("Link frame exceeds limit".into()));
    }
    let length = u32::try_from(bytes.len())
        .map_err(|_| LinkError::Protocol("invalid frame length".into()))?;
    writer.write_u32(length).await.map_err(io)?;
    writer.write_all(bytes).await.map_err(io)
}
#[allow(clippy::needless_pass_by_value)] // Consumes errors supplied by map_err.
fn io(error: std::io::Error) -> LinkError {
    LinkError::Unavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn oversized_length_is_rejected_before_reading_a_body() {
        let mut bytes = (u32::try_from(ovule_link_protocol::MAX_FRAME).unwrap() + 1)
            .to_be_bytes()
            .as_slice()
            .to_owned();
        assert!(matches!(
            read_frame(&mut bytes.as_slice()).await,
            Err(LinkError::Protocol(_))
        ));
        bytes.clear();
    }
    #[tokio::test]
    async fn frames_round_trip_and_truncated_frames_fail() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, b"hello").await.unwrap();
        assert_eq!(read_frame(&mut bytes.as_slice()).await.unwrap(), b"hello");
        bytes.pop();
        assert!(read_frame(&mut bytes.as_slice()).await.is_err());
    }
}
