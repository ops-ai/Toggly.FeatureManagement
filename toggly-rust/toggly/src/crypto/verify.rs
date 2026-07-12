//! ES256 verification of signed definitions envelopes.

use super::jwks::validate_and_parse_es256_key;
use crate::definitions::{JwkSet, SignedDefinitionsResponse};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ecdsa::signature::hazmat::PrehashVerifier;
use p256::ecdsa::Signature;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use thiserror::Error;

/// Errors verifying a signed definitions response.
#[derive(Debug, Error)]
pub enum VerifyError {
    /// Envelope or JWKS missing required data.
    #[error("{0}")]
    Message(String),
    /// No matching JWK for the envelope kid.
    #[error("no matching jwk for kid {0:?}")]
    NoMatchingKey(String),
    /// JWK validation failed.
    #[error("{0}")]
    Jwk(#[from] super::jwks::DecodeB64Error),
    /// Signature base64 decode failed.
    #[error("decode signature: {0}")]
    SignatureDecode(String),
    /// Cryptographic signature check failed.
    #[error("invalid signature")]
    InvalidSignature,
}

/// Verify a signed definitions response.
///
/// Expects:
/// - `env.defs` is the exact raw JSON bytes from the `"defs"` property
/// - `env.timestamp` is the integer Unix timestamp (seconds)
/// - `env.signature` is standard base64 of the ES256 signature
pub fn verify_signed_definitions(
    env: &SignedDefinitionsResponse,
    jwks: &JwkSet,
    allowed_kid: Option<&HashSet<String>>,
) -> Result<(), VerifyError> {
    if jwks.keys.is_empty() {
        return Err(VerifyError::Message("empty jwks".into()));
    }

    let pub_key = find_key(jwks, &env.kid, allowed_kid)?;

    let payload = format!("{}|{}", env.defs.get(), env.timestamp);
    // The definitions signer pre-hashes data before calling crypto.subtle.sign
    // which hashes again internally — match that double-hash here.
    let first = Sha256::digest(payload.as_bytes());
    let hash = Sha256::digest(first);

    let sig_bytes = STANDARD
        .decode(&env.signature)
        .map_err(|e| VerifyError::SignatureDecode(e.to_string()))?;

    // Web Crypto API produces IEEE P1363 format (raw r||s, 64 bytes for P-256).
    // Fall back to ASN.1/DER for Azure Key Vault signatures.
    let signature = if sig_bytes.len() == 64 {
        Signature::from_slice(&sig_bytes).map_err(|_| VerifyError::InvalidSignature)?
    } else {
        Signature::from_der(&sig_bytes).map_err(|_| VerifyError::InvalidSignature)?
    };

    pub_key
        .verify_prehash(&hash, &signature)
        .map_err(|_| VerifyError::InvalidSignature)?;

    Ok(())
}

fn find_key(
    jwks: &JwkSet,
    kid: &str,
    allowed_kid: Option<&HashSet<String>>,
) -> Result<p256::ecdsa::VerifyingKey, VerifyError> {
    for k in &jwks.keys {
        if k.kid != kid {
            continue;
        }
        return validate_and_parse_es256_key(k, allowed_kid).map_err(Into::into);
    }
    Err(VerifyError::NoMatchingKey(kid.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definitions::Jwk;
    use p256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey};
    use p256::SecretKey;
    use rand::rngs::OsRng;
    use sha1::{Digest, Sha1};

    fn pad32(b: &[u8]) -> [u8; 32] {
        let mut out = [0u8; 32];
        let start = 32 - b.len().min(32);
        out[start..].copy_from_slice(&b[b.len().saturating_sub(32)..]);
        out
    }

    fn make_keypair() -> (SigningKey, Jwk) {
        let secret = SecretKey::random(&mut OsRng);
        let signing = SigningKey::from(secret);
        let verifying = signing.verifying_key();
        let point = verifying.to_encoded_point(false);
        let x = pad32(point.x().unwrap());
        let y = pad32(point.y().unwrap());

        let mut hasher = Sha1::new();
        hasher.update(x);
        hasher.update(y);
        let kid = format!("{}ES256", hex::encode_upper(hasher.finalize()));

        let jwk = Jwk {
            kty: "EC".into(),
            use_: Some("sig".into()),
            kid: kid.clone(),
            crv: Some("P-256".into()),
            x: Some(URL_SAFE_NO_PAD.encode(x)),
            y: Some(URL_SAFE_NO_PAD.encode(y)),
            alg: Some("ES256".into()),
            exp: None,
        };
        (signing, jwk)
    }

    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    fn sign_p1363(signing: &SigningKey, hash: &[u8]) -> Vec<u8> {
        let (sig, _) = signing.sign_prehash(hash).expect("sign");
        sig.to_bytes().to_vec()
    }

    fn double_hash(s: &str) -> [u8; 32] {
        let first = Sha256::digest(s.as_bytes());
        let second = Sha256::digest(first);
        second.into()
    }

    #[test]
    fn verify_ok_p1363() {
        let (signing, jwk) = make_keypair();
        let jwks = JwkSet {
            keys: vec![jwk.clone()],
        };
        let defs = r#"[{"featureKey":"demo","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]"#;
        let ts: i64 = 1730000000;
        let payload = format!("{defs}|{ts}");
        let sig = sign_p1363(&signing, &double_hash(&payload));

        let env = SignedDefinitionsResponse {
            defs: serde_json::value::RawValue::from_string(defs.to_string()).unwrap(),
            signature: STANDARD.encode(sig),
            timestamp: ts,
            kid: jwk.kid.clone(),
        };

        verify_signed_definitions(&env, &jwks, None).expect("verify ok");
    }

    #[test]
    fn verify_rejects_bad_signature() {
        let (signing, jwk) = make_keypair();
        let jwks = JwkSet {
            keys: vec![jwk.clone()],
        };
        let defs = "[]";
        let ts: i64 = 1730000000;
        let payload = format!("{defs}|{ts}");
        let mut sig = sign_p1363(&signing, &double_hash(&payload));
        sig[0] ^= 0xff;

        let env = SignedDefinitionsResponse {
            defs: serde_json::value::RawValue::from_string(defs.to_string()).unwrap(),
            signature: STANDARD.encode(sig),
            timestamp: ts,
            kid: jwk.kid.clone(),
        };

        assert!(matches!(
            verify_signed_definitions(&env, &jwks, None),
            Err(VerifyError::InvalidSignature)
        ));
    }

    #[test]
    fn verify_allowed_kid() {
        let (signing, jwk) = make_keypair();
        let jwks = JwkSet {
            keys: vec![jwk.clone()],
        };
        let defs = "[]";
        let ts: i64 = 1730000000;
        let payload = format!("{defs}|{ts}");
        let sig = sign_p1363(&signing, &double_hash(&payload));
        let env = SignedDefinitionsResponse {
            defs: serde_json::value::RawValue::from_string(defs.to_string()).unwrap(),
            signature: STANDARD.encode(sig),
            timestamp: ts,
            kid: jwk.kid.clone(),
        };

        let mut allowed = HashSet::new();
        allowed.insert(jwk.kid.clone());
        verify_signed_definitions(&env, &jwks, Some(&allowed)).expect("allowed");

        let mut disallowed = HashSet::new();
        disallowed.insert("nope".into());
        assert!(verify_signed_definitions(&env, &jwks, Some(&disallowed)).is_err());
    }

    #[test]
    fn raw_defs_must_not_be_reserialized() {
        // Compact vs pretty JSON of the same object must use exact bytes.
        let (signing, jwk) = make_keypair();
        let jwks = JwkSet {
            keys: vec![jwk.clone()],
        };
        let compact = r#"{"a":1}"#;
        let ts: i64 = 100;
        let payload = format!("{compact}|{ts}");
        let sig = sign_p1363(&signing, &double_hash(&payload));

        let env = SignedDefinitionsResponse {
            defs: serde_json::value::RawValue::from_string(compact.to_string()).unwrap(),
            signature: STANDARD.encode(sig),
            timestamp: ts,
            kid: jwk.kid.clone(),
        };
        verify_signed_definitions(&env, &jwks, None).expect("compact ok");

        // Re-serialized pretty form would produce a different payload digest.
        let pretty = "{\n  \"a\": 1\n}";
        let env_pretty = SignedDefinitionsResponse {
            defs: serde_json::value::RawValue::from_string(pretty.to_string()).unwrap(),
            signature: env.signature.clone(),
            timestamp: ts,
            kid: jwk.kid.clone(),
        };
        assert!(
            verify_signed_definitions(&env_pretty, &jwks, None).is_err(),
            "re-serialized defs must fail verification"
        );
    }
}
