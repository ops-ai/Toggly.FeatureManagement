//! Entity context mapper registry and startup catalog PUT.

use crate::context::TogglyEntityContext;
use crate::config::TogglyConfig;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};

/// Property schema posted to the dashboard catalog.
#[derive(Clone, Serialize)]
pub struct EntityContextPropertySchema {
    /// Property name.
    pub name: String,
    /// Property type (string, number, datetime, string[]).
    #[serde(rename = "type")]
    pub type_name: String,
}

/// Kind registration posted to `sdk/{appKey}/contexts`.
#[derive(Clone, Serialize)]
pub struct EntityContextSchemaRegistration {
    /// Context kind.
    pub kind: String,
    /// Key property name.
    #[serde(rename = "keyProperty")]
    pub key_property: String,
    /// Optional display name.
    #[serde(rename = "displayName", skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Property catalog.
    pub properties: Vec<EntityContextPropertySchema>,
}

static SCHEMAS: OnceLock<Mutex<Vec<EntityContextSchemaRegistration>>> = OnceLock::new();

fn schemas() -> &'static Mutex<Vec<EntityContextSchemaRegistration>> {
    SCHEMAS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Store a schema for the startup catalog PUT.
pub fn register_context_schema(registration: EntityContextSchemaRegistration) {
    if let Ok(mut guard) = schemas().lock() {
        guard.retain(|s| s.kind != registration.kind);
        guard.push(registration);
    }
}

/// Best-effort PUT of registered schemas. Transport errors are ignored.
pub async fn register_entity_contexts_at_startup(config: &TogglyConfig) {
    if config.disable_entity_context_registration {
        return;
    }
    if config.app_key.is_empty() {
        return;
    }
    let regs = match schemas().lock() {
        Ok(g) => g.clone(),
        Err(_) => return,
    };
    if regs.is_empty() {
        return;
    }
    let base = config.base_url.trim_end_matches('/');
    let url = format!("{}/sdk/{}/contexts", base, config.app_key);
    let payload = serde_json::json!({ "contexts": regs });
    let client = reqwest::Client::builder()
        .timeout(config.http_timeout)
        .build();
    let Ok(client) = client else {
        return;
    };
    let _ = client.put(url).json(&payload).send().await;
}

/// Placeholder so callers can map domain objects into [`TogglyEntityContext`].
pub fn map_passthrough(kind: impl Into<String>, key: impl Into<String>, attributes: std::collections::HashMap<String, serde_json::Value>) -> TogglyEntityContext {
    TogglyEntityContext {
        kind: kind.into(),
        key: key.into(),
        attributes,
    }
}
