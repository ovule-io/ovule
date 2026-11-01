pub fn ollama_openai_api_base() -> Result<String, String> {
    let host = std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "127.0.0.1:11434".to_owned());
    normalize_ollama_openai_api_base(&host)
}

pub fn normalize_ollama_openai_api_base(host: &str) -> Result<String, String> {
    let base = if host.starts_with("http://") || host.starts_with("https://") {
        host.to_owned()
    } else {
        format!("http://{host}")
    };
    let mut endpoint =
        url::Url::parse(&base).map_err(|error| format!("parse OLLAMA_HOST: {error}"))?;
    if !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err("OLLAMA_HOST must not contain credentials, query, or fragment".to_owned());
    }
    endpoint.set_path("/v1");
    Ok(endpoint.as_str().trim_end_matches('/').to_owned())
}

pub fn deep_seek_api_base() -> Result<String, String> {
    const OFFICIAL_BASE: &str = "https://api.deepseek.com";
    const TEST_MODE_ENV: &str = "OVULE_TEST_MODE";
    const TEST_BASE_ENV: &str = "OVULE_TEST_DEEPSEEK_API_BASE";
    let Ok(candidate) = std::env::var(TEST_BASE_ENV) else {
        return Ok(OFFICIAL_BASE.to_owned());
    };
    if std::env::var(TEST_MODE_ENV).as_deref() != Ok("1") {
        return Err(format!("{TEST_BASE_ENV} requires {TEST_MODE_ENV}=1"));
    }
    validate_deep_seek_api_base(&candidate)?;
    Ok(candidate.trim_end_matches('/').to_owned())
}

pub fn validate_deep_seek_api_base(candidate: &str) -> Result<(), String> {
    const TEST_BASE_ENV: &str = "OVULE_TEST_DEEPSEEK_API_BASE";
    let endpoint = url::Url::parse(candidate)
        .map_err(|error| format!("parse test DeepSeek API base: {error}"))?;
    let is_loopback = match endpoint.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if endpoint.scheme() != "http"
        || !is_loopback
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || endpoint.path() != "/"
    {
        return Err(format!(
            "{TEST_BASE_ENV} must be a loopback HTTP origin without credentials, path, query, or fragment"
        ));
    }
    Ok(())
}
