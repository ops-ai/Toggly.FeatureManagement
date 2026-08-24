"""Django app configuration for Toggly."""

from __future__ import annotations

from django.apps import AppConfig
from django.conf import settings
from toggly import TogglyClient, set_default_client
from toggly import TogglyConfig as BaseTogglyConfig


class TogglyConfig(AppConfig):
    """Django app configuration for Toggly feature flags."""

    name = "toggly_django"
    verbose_name = "Toggly Feature Flags"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:
        """Initialize Toggly client when Django starts."""
        toggly_settings = getattr(settings, "TOGGLY", {})

        if not toggly_settings:
            return

        config = BaseTogglyConfig(
            app_key=toggly_settings.get("APP_KEY"),
            environment=toggly_settings.get("ENVIRONMENT", "Production"),
            base_url=toggly_settings.get("BASE_URL", "https://definitions.toggly.io"),
            feature_defaults=toggly_settings.get("FEATURE_DEFAULTS", {}),
            refresh_interval=toggly_settings.get("REFRESH_INTERVAL", 180.0),
            use_signed_definitions=toggly_settings.get("USE_SIGNED_DEFINITIONS", False),
            enable_variants=toggly_settings.get("ENABLE_VARIANTS", False),
            connect_timeout=toggly_settings.get("CONNECT_TIMEOUT", 10.0),
            request_timeout=toggly_settings.get("REQUEST_TIMEOUT", 30.0),
            enable_usage_tracking=toggly_settings.get("ENABLE_USAGE_TRACKING", True),
            disable_background_refresh=toggly_settings.get(
                "DISABLE_BACKGROUND_REFRESH", False
            ),
            debug=toggly_settings.get("DEBUG", False),
        )

        client = TogglyClient(config)
        client.init()
        set_default_client(client)

        # Store client in app config for access
        self._client = client

    @property
    def client(self) -> TogglyClient | None:
        """Get the Toggly client instance."""
        return getattr(self, "_client", None)
