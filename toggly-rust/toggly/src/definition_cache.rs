//! Shared definition-refresh cache hit/miss helpers.

/// Outcome of one definition-refresh network attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshCacheOutcome {
    /// Served from local/cache without applying a new revision.
    Hit,
    /// Applied a new revision from the network.
    Miss,
}

/// HTTP classification for definitions refresh responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpCacheKind {
    /// HTTP 304 Not Modified.
    NotModified,
    /// HTTP 200 whose ETag or Last-Modified matches the existing revision.
    SameRevision,
    /// HTTP 200 with new content to apply.
    NewContent,
    /// Non-success status (caller treats as error / optional hit if cached).
    ErrorStatus,
}

/// Normalize an ETag/revision for comparison (strip weak prefix + quotes).
pub fn normalize_etag(etag: Option<&str>) -> Option<String> {
    let trimmed = etag?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut value = trimmed;
    if value.len() >= 2
        && (value.as_bytes()[0] == b'W' || value.as_bytes()[0] == b'w')
        && value.as_bytes()[1] == b'/'
    {
        value = value[2..].trim();
    }
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        return Some(value[1..value.len() - 1].to_string());
    }
    Some(value.to_string())
}

/// True when both ETags/revisions normalize to the same non-empty value.
pub fn etags_match(left: Option<&str>, right: Option<&str>) -> bool {
    match (normalize_etag(left), normalize_etag(right)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// True when both Last-Modified values are present and equal.
pub fn last_modified_match(left: Option<&str>, right: Option<&str>) -> bool {
    match (left.map(str::trim), right.map(str::trim)) {
        (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => a == b,
        _ => false,
    }
}

/// Match Go/Ruby: `current_ts > 0 && incoming_ts <= current_ts` → cached hit.
pub fn cached_signed_timestamp(current_ts: Option<i64>, incoming_ts: i64) -> bool {
    match current_ts {
        Some(current) if current > 0 && incoming_ts <= current => true,
        _ => false,
    }
}

/// Classify an HTTP definitions response for cache telemetry.
pub fn classify_http(
    status_code: u16,
    existing_etag: Option<&str>,
    response_etag: Option<&str>,
    existing_last_modified: Option<&str>,
    response_last_modified: Option<&str>,
) -> HttpCacheKind {
    if status_code == 304 {
        return HttpCacheKind::NotModified;
    }
    if status_code != 200 {
        return HttpCacheKind::ErrorStatus;
    }
    if etags_match(existing_etag, response_etag)
        || last_modified_match(existing_last_modified, response_last_modified)
    {
        return HttpCacheKind::SameRevision;
    }
    HttpCacheKind::NewContent
}

/// Optional recorder for definition-refresh cache counters on the usage pipeline.
pub trait DefinitionCacheRecorder: Send + Sync {
    /// Count a refresh served from local cache / unchanged revision.
    fn record_definition_cache_hit(&self);
    /// Count a refresh that applied a new revision.
    fn record_definition_cache_miss(&self);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_weak_and_strong_etags() {
        assert!(etags_match(Some("\"1\""), Some("W/\"1\"")));
        assert!(!etags_match(Some("\"1\""), Some("\"2\"")));
        assert!(!etags_match(None, Some("\"1\"")));
    }

    #[test]
    fn matches_last_modified_and_signed_timestamps() {
        let lm = "Mon, 01 Jan 2024 00:00:00 GMT";
        assert!(last_modified_match(Some(lm), Some(lm)));
        assert!(!last_modified_match(Some(lm), None));
        assert!(cached_signed_timestamp(Some(100), 100));
        assert!(cached_signed_timestamp(Some(100), 50));
        assert!(!cached_signed_timestamp(Some(100), 101));
        assert!(!cached_signed_timestamp(Some(0), 50));
        assert!(!cached_signed_timestamp(None, 50));
    }

    #[test]
    fn classifies_http_responses() {
        assert_eq!(
            classify_http(304, Some("\"1\""), None, None, None),
            HttpCacheKind::NotModified
        );
        assert_eq!(
            classify_http(200, Some("\"1\""), Some("\"1\""), None, None),
            HttpCacheKind::SameRevision
        );
        assert_eq!(
            classify_http(200, Some("\"1\""), Some("\"2\""), None, None),
            HttpCacheKind::NewContent
        );
        assert_eq!(
            classify_http(500, Some("\"1\""), None, None, None),
            HttpCacheKind::ErrorStatus
        );
        let lm = "Mon, 01 Jan 2024 00:00:00 GMT";
        assert_eq!(
            classify_http(200, Some("\"1\""), Some("\"2\""), Some(lm), Some(lm)),
            HttpCacheKind::SameRevision
        );
    }
}
