//! # Toggly - Feature Flags SDK for Rust
//!
//! A high-performance, async-first Rust SDK for [Toggly](https://toggly.io) feature flags.
//!
//! ## Features
//!
//! - **Async-first**: Built on Tokio for efficient async operations
//! - **Type-safe**: Leverages Rust's type system for compile-time safety
//! - **Thread-safe**: Safe concurrent access with Arc and DashMap
//! - **Zero-cost abstractions**: Minimal overhead with idiomatic Rust patterns
//! - **Caching**: Built-in in-memory caching with configurable TTL
//! - **Builder pattern**: Ergonomic API for client configuration
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use toggly::{TogglyClient, TogglyConfig, EvalContext};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), toggly::Error> {
//!     // Create client with builder pattern
//!     let client = TogglyClient::builder()
//!         .app_key("your-app-key")
//!         .environment("production")
//!         .build()
//!         .await?;
//!
//!     // Check if a feature is enabled
//!     let enabled = client.is_enabled("my-feature", EvalContext::default()).await?;
//!
//!     if enabled {
//!         println!("Feature is enabled!");
//!     }
//!
//!     // Cleanup
//!     client.close().await;
//!
//!     Ok(())
//! }
//! ```
//!
//! ## Evaluation Context
//!
//! Provide user context for targeting rules:
//!
//! ```rust,no_run
//! use toggly::EvalContext;
//! use std::collections::HashMap;
//!
//! let mut traits = HashMap::new();
//! traits.insert("plan".to_string(), serde_json::json!("premium"));
//! traits.insert("country".to_string(), serde_json::json!("US"));
//!
//! let context = EvalContext::builder()
//!     .identity("user-123")
//!     .groups(vec!["beta-testers".to_string()])
//!     .traits(traits)
//!     .build();
//! ```
//!
//! ## Feature Gates
//!
//! Evaluate multiple features with AND/OR logic:
//!
//! ```rust,no_run
//! use toggly::{TogglyClient, EvalContext, Requirement};
//!
//! # async fn example(client: TogglyClient) -> Result<(), toggly::Error> {
//! // All features must be enabled
//! let all_enabled = client
//!     .evaluate_gate(
//!         &["feature-a", "feature-b"],
//!         Requirement::All,
//!         EvalContext::default(),
//!         false,
//!     )
//!     .await?;
//!
//! // Any feature must be enabled
//! let any_enabled = client
//!     .evaluate_gate(
//!         &["feature-a", "feature-b"],
//!         Requirement::Any,
//!         EvalContext::default(),
//!         false,
//!     )
//!     .await?;
//! # Ok(())
//! # }
//! ```

#![warn(missing_docs)]
#![warn(rustdoc::missing_crate_level_docs)]
#![cfg_attr(docsrs, feature(doc_cfg))]

mod client;
mod config;
mod context;
mod error;

pub mod cache;
pub mod crypto;
pub mod definitions;
pub mod entity_context;
pub mod eval;
pub mod provider;
mod sdk_identity;

pub use client::TogglyClient;
pub use config::{OnErrorCallback, TogglyConfig, TogglyConfigBuilder};
pub use context::{
    EvalContext, EvalContextBuilder, HttpRequestMapper, RequestContext, TogglyEntityContext,
};
pub use entity_context::{
    map_entity, register_context, register_context_schema, EntityContextMapper,
    EntityContextPropertySchema, EntityContextSchemaRegistration,
};
pub use error::Error;

/// Requirement type for feature gates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Requirement {
    /// At least one feature must be enabled.
    #[default]
    Any,
    /// All features must be enabled.
    All,
}

/// Result type alias for Toggly operations.
pub type Result<T> = std::result::Result<T, Error>;

/// Prelude module for convenient imports.
pub mod prelude {
    pub use crate::{
        Error, EvalContext, EvalContextBuilder, HttpRequestMapper, RequestContext, Requirement,
        Result, TogglyClient, TogglyConfig, TogglyConfigBuilder,
    };
}
