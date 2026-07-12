//! Signature verification for signed definitions responses.
//!
//! Matches Go `toggly/crypto/verify.go`: payload is exact raw `defs` JSON bytes
//! plus `"|"` plus the decimal timestamp, double-SHA-256 hashed, then ES256
//! verified (IEEE P1363 or ASN.1/DER).

mod jwks;
mod verify;

pub use jwks::{validate_and_parse_es256_key, DecodeB64Error};
pub use verify::{verify_signed_definitions, VerifyError};
