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
        self.send(reqwest::Method::GET, "/api/v2/segments", None)
            .await
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
        if body.trim().is_empty() {
            return Ok(Value::Null);
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

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn encodes_spaces_in_segment_names() {
        assert_eq!(encode_path_segment("Beta Testers"), "Beta%20Testers");
    }

    #[test]
    fn trims_trailing_slash_from_base_url() {
        let client = SegmentMembershipClient::new("key", Some("https://app.toggly.io/"));
        assert_eq!(client.base_url, "https://app.toggly.io");
    }

    #[test]
    fn defaults_app_base_url() {
        let client = SegmentMembershipClient::new("key", None);
        assert_eq!(client.base_url, "https://app.toggly.io");
    }

    #[tokio::test]
    async fn list_segments_uses_authorization_header() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v2/segments"))
            .and(header("Authorization", "backend-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([{"id":"list-1"}])))
            .mount(&server)
            .await;

        let client = SegmentMembershipClient::new("backend-key", Some(&server.uri()));
        let value = client.list_segments().await.expect("list");
        assert_eq!(value[0]["id"], "list-1");
    }

    #[tokio::test]
    async fn add_segment_members_posts_identifiers() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/segments/Beta%20Testers/items"))
            .and(header("Authorization", "backend-key"))
            .and(body_json(serde_json::json!({"identifiers":["user-1"]})))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id":"list-1","itemCount":1})))
            .mount(&server)
            .await;

        let client = SegmentMembershipClient::new("backend-key", Some(&server.uri()));
        let value = client
            .add_segment_members("Beta Testers", &["user-1".into()])
            .await
            .expect("add");
        assert_eq!(value["itemCount"], 1);
    }

    #[tokio::test]
    async fn remove_and_replace_segment_members() {
        let server = MockServer::start().await;
        Mock::given(method("DELETE"))
            .and(path("/api/v2/segments/vip/items"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id":"list-1"})))
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path("/api/v2/segments/vip/items"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id":"list-1","itemCount":0})))
            .mount(&server)
            .await;

        let client = SegmentMembershipClient::new("backend-key", Some(&server.uri()));
        client
            .remove_segment_members("vip", &["user-1".into()])
            .await
            .expect("remove");
        let replaced = client
            .replace_segment_members("vip", &[])
            .await
            .expect("replace");
        assert_eq!(replaced["itemCount"], 0);
    }

    #[tokio::test]
    async fn empty_success_body_returns_null() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v2/segments"))
            .respond_with(ResponseTemplate::new(204))
            .mount(&server)
            .await;

        let client = SegmentMembershipClient::new("backend-key", Some(&server.uri()));
        let value = client.list_segments().await.expect("empty");
        assert!(value.is_null());
    }

    #[tokio::test]
    async fn http_error_surfaces_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v2/segments"))
            .respond_with(ResponseTemplate::new(403).set_body_string("forbidden"))
            .mount(&server)
            .await;

        let client = SegmentMembershipClient::new("frontend-key", Some(&server.uri()));
        let err = client.list_segments().await.expect_err("forbidden");
        let message = err.to_string();
        assert!(message.contains("403"), "{message}");
    }
}
