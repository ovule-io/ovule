pub(crate) fn bounded_message(value: &str, default: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        default.to_owned()
    } else {
        value.chars().take(65_536).collect()
    }
}

pub use ovule_agent_api::serialized_size_up_to;
