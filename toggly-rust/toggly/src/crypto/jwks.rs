//! JWK validation for ES256 signing keys.

use crate::definitions::Jwk;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use p256::ecdsa::VerifyingKey;
use p256::elliptic_curve::sec1::FromEncodedPoint;
use p256::{EncodedPoint, PublicKey};
use sha1::{Digest, Sha1};
use std::collections::HashSet;
use thiserror::Error;

/// Errors decoding or validating a JWK.
#[derive(Debug, Error)]
pub enum DecodeB64Error {
    /// Base64 decode failed.
    #[error("base64 decode: {0}")]
    Base64(String),
    /// Unsupported algorithm.
    #[error("unsupported alg: {0}")]
    UnsupportedAlg(String),
    /// Unsupported curve.
    #[error("unsupported crv: {0}")]
    UnsupportedCrv(String),
    /// Key ID is not in the allow-list.
    #[error("kid not allowed: {0}")]
    KidNotAllowed(String),
    /// Computed kid does not match the JWK kid.
    #[error("invalid kid: expected {expected}, got {got}")]
    InvalidKid {
        /// Expected kid from x||y hash.
        expected: String,
        /// Kid present on the JWK.
        got: String,
    },
    /// Missing x/y coordinates.
    #[error("missing x or y coordinate")]
    MissingCoordinates,
    /// Point is not on P-256.
    #[error("point not on P-256: {0}")]
    InvalidPoint(String),
}

/// Validate a JWK and return a usable ECDSA verifying key.
///
/// Validation matches server + Go SDK behavior:
/// - alg must be ES256
/// - curve must be P-256
/// - kid must equal uppercase hex(sha1(x||y)) + "ES256"
pub fn validate_and_parse_es256_key(
    jwk: &Jwk,
    allowed_kid: Option<&HashSet<String>>,
) -> Result<VerifyingKey, DecodeB64Error> {
    let alg = jwk.alg.as_deref().unwrap_or("");
    if alg != "ES256" {
        return Err(DecodeB64Error::UnsupportedAlg(alg.to_string()));
    }
    let crv = jwk.crv.as_deref().unwrap_or("");
    if crv != "P-256" {
        return Err(DecodeB64Error::UnsupportedCrv(crv.to_string()));
    }
    if let Some(allowed) = allowed_kid {
        if !allowed.is_empty() && !allowed.contains(&jwk.kid) {
            return Err(DecodeB64Error::KidNotAllowed(jwk.kid.clone()));
        }
    }

    let x_b64 = jwk.x.as_deref().ok_or(DecodeB64Error::MissingCoordinates)?;
    let y_b64 = jwk.y.as_deref().ok_or(DecodeB64Error::MissingCoordinates)?;

    let x_bytes = URL_SAFE_NO_PAD
        .decode(x_b64)
        .map_err(|e| DecodeB64Error::Base64(e.to_string()))?;
    let y_bytes = URL_SAFE_NO_PAD
        .decode(y_b64)
        .map_err(|e| DecodeB64Error::Base64(e.to_string()))?;

    let mut hasher = Sha1::new();
    hasher.update(&x_bytes);
    hasher.update(&y_bytes);
    let digest = hasher.finalize();
    let computed = format!("{}ES256", hex::encode_upper(digest));
    if jwk.kid != computed {
        return Err(DecodeB64Error::InvalidKid {
            expected: computed,
            got: jwk.kid.clone(),
        });
    }

    let mut uncompressed = Vec::with_capacity(1 + x_bytes.len() + y_bytes.len());
    uncompressed.push(0x04);
    uncompressed.extend_from_slice(&x_bytes);
    uncompressed.extend_from_slice(&y_bytes);

    let point = EncodedPoint::from_bytes(&uncompressed)
        .map_err(|e| DecodeB64Error::InvalidPoint(e.to_string()))?;
    let public_key =
        PublicKey::from_encoded_point(&point).into_option().ok_or_else(|| {
            DecodeB64Error::InvalidPoint("failed to decode public key".to_string())
        })?;

    Ok(VerifyingKey::from(public_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_wrong_alg() {
        let jwk = Jwk {
            kty: "EC".into(),
            use_: Some("sig".into()),
            kid: "x".into(),
            crv: Some("P-256".into()),
            x: Some("a".into()),
            y: Some("b".into()),
            alg: Some("RS256".into()),
            exp: None,
        };
        assert!(matches!(
            validate_and_parse_es256_key(&jwk, None),
            Err(DecodeB64Error::UnsupportedAlg(_))
        ));
    }
}
