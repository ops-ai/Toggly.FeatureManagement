//! Entity context mapper registry and startup catalog PUT.

use crate::config::TogglyConfig;
use crate::context::TogglyEntityContext;
use serde::Serialize;
use std::any::Any;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// Maps a domain object to [`TogglyEntityContext`].
pub type EntityContextMapper = Arc<dyn Fn(&dyn Any) -> TogglyEntityContext + Send + Sync>;

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
static MAPPERS: OnceLock<Mutex<HashMap<String, EntityContextMapper>>> = OnceLock::new();

fn schemas() -> &'static Mutex<Vec<EntityContextSchemaRegistration>> {
    SCHEMAS.get_or_init(|| Mutex::new(Vec::new()))
}

fn mappers() -> &'static Mutex<HashMap<String, EntityContextMapper>> {
    MAPPERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Store a schema for the startup catalog PUT.
pub fn register_context_schema(registration: EntityContextSchemaRegistration) {
    if let Ok(mut guard) = schemas().lock() {
        guard.retain(|s| s.kind != registration.kind);
        guard.push(registration);
    }
}

/// Register a local mapper from a domain object to `{kind, key, attributes}`.
///
/// Optional `schema` is stored for the startup catalog PUT.
pub fn register_context(
    kind: impl Into<String>,
    mapper: impl Fn(&dyn Any) -> TogglyEntityContext + Send + Sync + 'static,
    schema: Option<EntityContextSchemaRegistration>,
) {
    let kind = kind.into();
    if let Ok(mut guard) = mappers().lock() {
        guard.insert(kind.clone(), Arc::new(mapper));
    }
    if let Some(mut registration) = schema {
        registration.kind = kind.clone();
        if registration.display_name.is_none() {
            registration.display_name = Some(kind);
        }
        register_context_schema(registration);
    }
}

/// Resolve a domain object through the mapper registered for `kind`.
///
/// The mapper is cloned under the lock, then invoked after the guard is
/// dropped so user callbacks can call `register_context` / `map_entity`
/// without deadlocking or poisoning the registry mutex.
pub fn map_entity(kind: &str, entity: &dyn Any) -> Option<TogglyEntityContext> {
    let mapper = {
        let guard = mappers().lock().ok()?;
        guard.get(kind)?.clone()
    };
    Some(mapper(entity))
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
pub fn map_passthrough(
    kind: impl Into<String>,
    key: impl Into<String>,
    attributes: HashMap<String, serde_json::Value>,
) -> TogglyEntityContext {
    TogglyEntityContext {
        kind: kind.into(),
        key: key.into(),
        attributes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Order {
        id: String,
        color: String,
        age: i32,
    }

    #[test]
    fn register_context_maps_entity_object() {
        register_context(
            "Order",
            |obj| {
                let order = obj.downcast_ref::<Order>().expect("Order");
                let mut attributes = HashMap::new();
                attributes.insert("color".to_string(), serde_json::json!(order.color));
                attributes.insert("age".to_string(), serde_json::json!(order.age));
                TogglyEntityContext {
                    kind: "Order".to_string(),
                    key: order.id.clone(),
                    attributes,
                }
            },
            Some(EntityContextSchemaRegistration {
                kind: String::new(),
                key_property: "id".to_string(),
                display_name: None,
                properties: vec![EntityContextPropertySchema {
                    name: "color".to_string(),
                    type_name: "string".to_string(),
                }],
            }),
        );

        let order = Order {
            id: "p1".to_string(),
            color: "red".to_string(),
            age: 3,
        };
        let mapped = map_entity("Order", &order).expect("mapper registered");
        assert_eq!(mapped.kind, "Order");
        assert_eq!(mapped.key, "p1");
        assert_eq!(mapped.attributes.get("color").unwrap(), "red");
        assert_eq!(mapped.attributes.get("age").unwrap(), 3);

        let schemas = schemas().lock().unwrap();
        assert!(schemas
            .iter()
            .any(|s| s.kind == "Order" && s.key_property == "id"));
        assert!(map_entity("UnknownKind", &order).is_none());
    }

    #[test]
    fn map_entity_releases_lock_before_invoking_mapper() {
        register_context(
            "ReentrancyOuter",
            |obj| {
                register_context(
                    "ReentrancyInner",
                    |_| TogglyEntityContext {
                        kind: "ReentrancyInner".to_string(),
                        key: "inner".to_string(),
                        attributes: HashMap::new(),
                    },
                    None,
                );
                let nested = map_entity("ReentrancyInner", obj).expect("nested map_entity");
                TogglyEntityContext {
                    kind: "ReentrancyOuter".to_string(),
                    key: nested.key,
                    attributes: HashMap::new(),
                }
            },
            None,
        );

        let order = Order {
            id: "p1".to_string(),
            color: "red".to_string(),
            age: 3,
        };
        let mapped = map_entity("ReentrancyOuter", &order).expect("outer mapper");
        assert_eq!(mapped.kind, "ReentrancyOuter");
        assert_eq!(mapped.key, "inner");
    }

    #[test]
    fn map_passthrough_builds_entity_context() {
        let mut attributes = HashMap::new();
        attributes.insert("plan".to_string(), serde_json::json!("pro"));
        let ctx = map_passthrough("Account", "a1", attributes);
        assert_eq!(ctx.kind, "Account");
        assert_eq!(ctx.key, "a1");
    }
}
