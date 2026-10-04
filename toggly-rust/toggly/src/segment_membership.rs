//! Backend-key targeting-list membership client.

use reqwest::Client;
use serde::Serialize;
use serde_json::Value;

use crate::Error;

/// Client for `/api/v2/segments` on `app.toggly.io`.
pub struct SegmentMembershipClient {
    app_key: String,
    base_url: String,
    http: Client,
}

#[derive(Serialize)]
struct IdentifiersBody<'a> {
    identifiers: &'a [String],
}

impl SegmentMembershipClient {
    /// Create a client. `app_base_url` defaults to `https://app.toggly.io`.
    pub fn new(app_key: impl Into<String>, app_base_url: Option<&str>) -> Self {
        let base = app_base_url
            .unwrap_or("https://app.toggly.io")
            .trim_end_matches('/');
        Self {
            app_key: app_key.into(),
            base_url: base.to_string(),
            http: Client::new(),
        }
    }

    /// List segments this Backend key may update.
    pub async fn list_segments(&self) -> Result<Value, Error> {
        self.send(reqwest::Method::GET, "/api/v2/segments", None).await
    }

    /// Add identifiers to a segment.
    pub async fn add_segment_members(
        &self,
        segment: &str,
        identifiers: &[String],
    ) -> Result<Value, Error> {
        self.send(
            reqwest::Method::POST,
            &format!("/api/v2/segments/{}/items", encode_path_segment(segment)),
            Some(identifiers),
        )
        .await
    }

    /// Remove identifiers from a segment.
    pub async fn remove_segment_members(
        &self,
        segment: &str,
        identifiers: &[String],
    ) -> Result<Value, Error> {
        self.send(
            reqwest::Method::DELETE,
            &format!("/api/v2/segments/{}/items", encode_path_segment(segment)),
            Some(identifiers),
        )
        .await
    }

    /// Replace all identifiers on a segment (max 500).
    pub async fn replace_segment_members(
        &self,
        segment: &str,
        identifiers: &[String],
    ) -> Result<Value, Error> {
        self.send(
            reqwest::Method::PUT,
            &format!("/api/v2/segments/{}/items", encode_path_segment(segment)),
            Some(identifiers),
        )
        .await
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        identifiers: Option<&[String]>,
    ) -> Result<Value, Error> {
        let mut request = self
            .http
            .request(method, format!("{}{path}", self.base_url))
            .header("Authorization", &self.app_key)
            .header("Accept", "application/json");
        if let Some(ids) = identifiers {
            request = request.json(&IdentifiersBody { identifiers: ids });
        }
        let response = request.send().await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(Error::Provider(format!(
                "segment membership failed: {status} {body}"
            )));
        }
        Ok(serde_json::from_str(&body)?)
    }
}

fn encode_path_segment(value: &str) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
