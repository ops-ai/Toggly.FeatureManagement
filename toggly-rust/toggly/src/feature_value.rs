//! Soft-decode a resolved feature's value by its declared catalog
//! [`FeatureValueType`](crate::definitions::FeatureValueType) (OPS-2102).
//!
//! Mirrors the wire contract used across Toggly SDKs: a feature definition
//! may carry a `valueType` of `boolean | string | number | json | datetime`.
//! These helpers never panic solely for a shape mismatch and never return a
//! wrong-typed value — they soft-null (`None`) on a declared-type mismatch
//! or a decode failure. Legacy catalogs without a declared value type
//! (`declared == None`) still attempt the decode so older flags keep
//! working.
//!
//! Reuses the same soft-null shape as [`TogglyClient::get_variant_value_as`]
//! (OPS-1365), applied to the flag's own value rather than a variant's
//! configuration payload.
//!
//! [`TogglyClient::get_variant_value_as`]: crate::TogglyClient::get_variant_value_as

use crate::definitions::FeatureValueType;
use chrono::{DateTime, FixedOffset};
use serde_json::Value;

/// Soft-decodes `raw` as a `String`. Returns `None` on a declared-type
/// mismatch or a non-string value.
pub fn decode_string(raw: Option<&Value>, declared: Option<FeatureValueType>) -> Option<String> {
    if !FeatureValueType::matches(declared, FeatureValueType::String) {
        return None;
    }
    raw?.as_str().map(|s| s.to_string())
}

/// Soft-decodes `raw` as a finite `f64`. Returns `None` on a declared-type
/// mismatch, a non-numeric value, or an unparsable string. Booleans are
/// never treated as `0`/`1`.
pub fn decode_number(raw: Option<&Value>, declared: Option<FeatureValueType>) -> Option<f64> {
    if !FeatureValueType::matches(declared, FeatureValueType::Number) {
        return None;
    }
    let raw = raw?;
    if raw.is_boolean() {
        return None;
    }
    if let Some(n) = raw.as_f64() {
        return n.is_finite().then_some(n);
    }
    raw.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|n| n.is_finite())
}

/// Soft-decodes `raw` as a parsed JSON object/array. Returns `None` on a
/// declared-type mismatch or an undecodable value.
pub fn decode_json(raw: Option<&Value>, declared: Option<FeatureValueType>) -> Option<Value> {
    if !FeatureValueType::matches(declared, FeatureValueType::Json) {
        return None;
    }
    match raw? {
        v @ (Value::Object(_) | Value::Array(_)) => Some(v.clone()),
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(v @ (Value::Object(_) | Value::Array(_))) => Some(v),
            _ => None,
        },
        _ => None,
    }
}

/// Soft-decodes `raw` as a [`DateTime<FixedOffset>`] parsed from an
/// ISO-8601/RFC 3339 string. Returns `None` on a declared-type mismatch, a
/// non-string input, or an unparsable value.
pub fn decode_datetime(
    raw: Option<&Value>,
    declared: Option<FeatureValueType>,
) -> Option<DateTime<FixedOffset>> {
    if !FeatureValueType::matches(declared, FeatureValueType::Datetime) {
        return None;
    }
    raw?.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decode_string_accepts_string_and_rejects_mismatch() {
        assert_eq!(
            decode_string(Some(&json!("hello")), None),
            Some("hello".to_string())
        );
        assert_eq!(decode_string(Some(&json!(42)), None), None);
        assert_eq!(
            decode_string(Some(&json!("hello")), Some(FeatureValueType::Number)),
            None
        );
        assert_eq!(decode_string(None, None), None);
    }

    #[test]
    fn decode_number_accepts_numbers_and_numeric_strings_never_booleans() {
        assert_eq!(decode_number(Some(&json!(42)), None), Some(42.0));
        assert_eq!(decode_number(Some(&json!("2.5")), None), Some(2.5));
        assert_eq!(decode_number(Some(&json!(true)), None), None);
        assert_eq!(decode_number(Some(&json!("not-a-number")), None), None);
        assert_eq!(
            decode_number(Some(&json!(42)), Some(FeatureValueType::String)),
            None
        );
    }

    #[test]
    fn decode_json_accepts_objects_arrays_and_json_strings_only() {
        assert_eq!(
            decode_json(Some(&json!({"a": 1})), None),
            Some(json!({"a": 1}))
        );
        assert_eq!(
            decode_json(Some(&json!(r#"{"a": 1}"#)), None),
            Some(json!({"a": 1}))
        );
        assert_eq!(decode_json(Some(&json!("not json")), None), None);
        assert_eq!(decode_json(Some(&json!("\"a plain string\"")), None), None);
        assert_eq!(
            decode_json(Some(&json!({"a": 1})), Some(FeatureValueType::String)),
            None
        );
    }

    #[test]
    fn decode_datetime_parses_iso8601_and_soft_nulls_on_bad_input() {
        let decoded = decode_datetime(Some(&json!("2026-01-15T10:30:00Z")), None);
        assert!(decoded.is_some());
        let decoded = decoded.unwrap();
        assert_eq!(decoded.format("%Y-%m-%d").to_string(), "2026-01-15");

        assert_eq!(decode_datetime(Some(&json!("not-a-date")), None), None);
        assert_eq!(decode_datetime(Some(&json!(12345)), None), None);
        assert_eq!(
            decode_datetime(
                Some(&json!("2026-01-15T10:30:00Z")),
                Some(FeatureValueType::String)
            ),
            None
        );
    }

    #[test]
    fn legacy_none_declared_type_allows_any_decode_attempt() {
        assert!(FeatureValueType::matches(None, FeatureValueType::String));
        assert!(!FeatureValueType::matches(
            Some(FeatureValueType::Number),
            FeatureValueType::String
        ));
        assert!(FeatureValueType::matches(
            Some(FeatureValueType::String),
            FeatureValueType::String
        ));
    }
}
