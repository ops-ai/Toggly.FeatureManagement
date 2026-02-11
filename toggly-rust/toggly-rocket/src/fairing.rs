//! Fairings for Rocket.

use rocket::{
    fairing::{Fairing, Info, Kind},
    Build, Rocket,
};
use toggly::{TogglyClient, TogglyConfig};
use tracing::{error, info};

/// Fairing for initializing Toggly.
///
/// # Example
///
/// ```rust,ignore
/// use rocket::launch;
/// use toggly_rocket::TogglyFairing;
///
/// #[launch]
/// fn rocket() -> _ {
///     rocket::build()
///         .attach(TogglyFairing::from_config(
///             TogglyConfig::builder()
///                 .app_key("your-app-key")
///                 .environment("production")
///                 .build()
///         ))
/// }
/// ```
pub struct TogglyFairing {
    config: TogglyConfig,
}

impl TogglyFairing {
    /// Create a fairing from configuration.
    pub fn from_config(config: TogglyConfig) -> Self {
        Self { config }
    }

    /// Create a fairing with basic configuration.
    pub fn new(app_key: impl Into<String>, environment: impl Into<String>) -> Self {
        Self {
            config: TogglyConfig::builder()
                .app_key(app_key)
                .environment(environment)
                .build(),
        }
    }
}

#[rocket::async_trait]
impl Fairing for TogglyFairing {
    fn info(&self) -> Info {
        Info {
            name: "Toggly Feature Flags",
            kind: Kind::Ignite,
        }
    }

    async fn on_ignite(&self, rocket: Rocket<Build>) -> rocket::fairing::Result {
        match TogglyClient::new(self.config.clone()).await {
            Ok(client) => {
                info!(
                    app_key = %self.config.app_key,
                    environment = %self.config.environment,
                    "Toggly client initialized"
                );
                Ok(rocket.manage(client))
            }
            Err(e) => {
                error!(error = %e, "Failed to initialize Toggly client");
                Err(rocket)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fairing_new() {
        let fairing = TogglyFairing::new("test-key", "production");
        assert_eq!(fairing.config.app_key, "test-key");
        assert_eq!(fairing.config.environment, "production");
    }
}
