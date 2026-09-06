//! FNV-1a identity hashing and timestamp helpers for telemetry payloads.

/// Default gRPC metrics/usage base URL (matches .NET / Go / Ruby).
pub const DEFAULT_METRICS_BASE_URL: &str = "https://app.toggly.io/";

/// Default flush interval in seconds (~1 minute, matching .NET).
pub const DEFAULT_TELEMETRY_FLUSH_SECS: u64 = 60;

/// FNV-1a 32-bit hash of UTF-8 identity bytes, returned as a signed `i32`
/// (matches Go `hash/fnv`, Node, Python, Ruby golden vectors).
pub fn hash_identity(identity: &str) -> i32 {
    let mut h: u32 = 2_166_136_261;
    for byte in identity.as_bytes() {
        h ^= u32::from(*byte);
        h = h.wrapping_mul(16_777_619);
    }
    h as i32
}

/// Protobuf Timestamp shape (`seconds` + `nanos`) from a Unix millis instant.
pub fn to_protobuf_timestamp_millis(millis: i64) -> (i64, i32) {
    let seconds = millis.div_euclid(1000);
    let nanos = (millis.rem_euclid(1000) * 1_000_000) as i32;
    (seconds, nanos)
}

/// Current UTC time as protobuf Timestamp fields.
pub fn now_protobuf_timestamp() -> (i64, i32) {
    let millis = chrono::Utc::now().timestamp_millis();
    to_protobuf_timestamp_millis(millis)
}

/// Resolve `toggly-rust/{VERSION}` user-agent for gRPC `UA` metadata.
pub fn resolve_user_agent(override_ua: Option<&str>) -> String {
    override_ua
        .map(str::to_string)
        .unwrap_or_else(crate::sdk_identity::sdk_user_agent)
}

/// Build `host:port` target for a tonic/gRPC channel from a base URL.
pub fn grpc_target(base_url: &str) -> String {
    let raw = base_url.trim();
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let host = url::Url::parse(&with_scheme)
        .ok()
        .and_then(|u| {
            u.host_str().map(|h| {
                if let Some(port) = u.port() {
                    format!("{h}:{port}")
                } else {
                    h.to_string()
                }
            })
        })
        .unwrap_or_else(|| {
            raw.trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_end_matches('/')
                .to_string()
        });
    let host = host.trim_end_matches('/').to_string();
    if host.is_empty() {
        return "app.toggly.io:443".to_string();
    }
    if host.contains(':') {
        host
    } else {
        format!("{host}:443")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_identity_golden_vectors() {
        assert_eq!(hash_identity("alice"), -2_027_809_817);
        assert_eq!(hash_identity("café"), -1_473_556_407);
        assert_eq!(hash_identity("🚀"), 2_141_686_490);
        assert_eq!(hash_identity("alice"), hash_identity("alice"));
        assert_ne!(hash_identity("alice"), hash_identity("bob"));
    }

    #[test]
    fn grpc_target_defaults_https_443() {
        assert_eq!(grpc_target("https://app.toggly.io/"), "app.toggly.io:443");
        assert_eq!(grpc_target("app.toggly.io"), "app.toggly.io:443");
    }
}
