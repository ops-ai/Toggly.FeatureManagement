//! Sticky percentage bucketing aligned with Definitions / toggly-eval.

use sha2::{Digest, Sha256};

/// Sticky bucket in `[0, 100)` matching Definitions / toggly-eval SHA-256.
///
/// Hash input is `feature_key + "\n" + user_id`; little-endian uint32 from the
/// first 4 digest bytes, then `(value / 0xFFFFFFFF) * 100`.
pub fn compute_percentile(user_id: &str, feature_key: &str) -> f64 {
    let mut hasher = Sha256::new();
    hasher.update(feature_key.as_bytes());
    hasher.update(b"\n");
    hasher.update(user_id.as_bytes());
    let digest = hasher.finalize();
    let value = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]);
    (f64::from(value) / f64::from(u32::MAX)) * 100.0
}

/// Percentage gate for segment filters; missing or `≤0` fails closed.
pub fn segment_percentage_passes(
    percentage: Option<f64>,
    feature_key: &str,
    identity: Option<&str>,
) -> bool {
    let Some(percentage) = percentage else {
        return false;
    };
    if percentage <= 0.0 {
        return false;
    }
    if percentage >= 100.0 {
        return true;
    }
    if let Some(id) = identity.filter(|s| !s.is_empty()) {
        return compute_percentile(id, feature_key) < percentage;
    }
    rand::random::<f64>() * 100.0 < percentage
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sticky_bucket_is_deterministic_and_in_range() {
        let a = compute_percentile("user-123", "feature-a");
        let b = compute_percentile("user-123", "feature-a");
        assert_eq!(a, b);
        assert!((0.0..100.0).contains(&a));
    }

    #[test]
    fn segment_percentage_fail_closed_when_missing_or_zero() {
        assert!(!segment_percentage_passes(None, "f", Some("u")));
        assert!(!segment_percentage_passes(Some(0.0), "f", Some("u")));
        assert!(!segment_percentage_passes(Some(-1.0), "f", Some("u")));
        assert!(segment_percentage_passes(Some(100.0), "f", Some("u")));
    }
}
