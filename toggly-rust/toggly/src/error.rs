//! Error types for the Toggly SDK.

use std::fmt;

/// Error type for Toggly SDK operations.
#[derive(Debug)]
pub enum Error {
    /// Configuration error (e.g., missing required fields).
    Config(String),

    /// HTTP request error.
    Http(reqwest::Error),

    /// JSON serialization/deserialization error.
    Json(serde_json::Error),

    /// Feature not found.
    FeatureNotFound(String),

    /// Evaluation error.
    Evaluation(String),

    /// Provider error (e.g., failed to fetch definitions).
    Provider(String),

    /// Cache error.
    Cache(String),

    /// Timeout error.
    Timeout(String),

    /// Internal error.
    Internal(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Config(msg) => write!(f, "configuration error: {}", msg),
            Error::Http(err) => write!(f, "HTTP error: {}", err),
            Error::Json(err) => write!(f, "JSON error: {}", err),
            Error::FeatureNotFound(key) => write!(f, "feature not found: {}", key),
            Error::Evaluation(msg) => write!(f, "evaluation error: {}", msg),
            Error::Provider(msg) => write!(f, "provider error: {}", msg),
            Error::Cache(msg) => write!(f, "cache error: {}", msg),
            Error::Timeout(msg) => write!(f, "timeout: {}", msg),
            Error::Internal(msg) => write!(f, "internal error: {}", msg),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Http(err) => Some(err),
            Error::Json(err) => Some(err),
            _ => None,
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(err: reqwest::Error) -> Self {
        Error::Http(err)
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::Json(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error as StdError;

    #[test]
    fn test_error_display() {
        let err = Error::Config("missing app_key".to_string());
        assert_eq!(err.to_string(), "configuration error: missing app_key");

        let err = Error::FeatureNotFound("my-feature".to_string());
        assert_eq!(err.to_string(), "feature not found: my-feature");
    }

    #[test]
    fn test_error_source() {
        let config_err = Error::Config("test".to_string());
        assert!(config_err.source().is_none());
    }
}
