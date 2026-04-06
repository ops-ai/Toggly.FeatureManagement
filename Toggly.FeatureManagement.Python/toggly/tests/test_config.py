"""Tests for TogglyConfig."""

import pytest

from toggly import TogglyConfig


class TestTogglyConfig:
    """Tests for TogglyConfig class."""

    def test_config_with_minimal_parameters(self) -> None:
        """Test config creation with minimal parameters."""
        config = TogglyConfig(app_key="test-key")

        assert config.app_key == "test-key"
        assert config.base_url == "https://definitions.toggly.io"
        assert config.environment == "Production"
        assert config.feature_defaults == {}
        assert config.refresh_interval == 180.0
        assert config.use_signed_definitions is False
        assert config.enable_variants is False

    def test_config_with_all_parameters(self) -> None:
        """Test config creation with all parameters."""
        feature_defaults = {"feature1": True}
        config = TogglyConfig(
            app_key="my-key",
            base_url="https://custom.api.com",
            environment="staging",
            identity="user-123",
            feature_defaults=feature_defaults,
            refresh_interval=30.0,
            use_signed_definitions=True,
            enable_variants=True,
            connect_timeout=5.0,
            request_timeout=15.0,
        )

        assert config.app_key == "my-key"
        assert config.base_url == "https://custom.api.com"
        assert config.environment == "staging"
        assert config.identity == "user-123"
        assert config.feature_defaults == feature_defaults
        assert config.refresh_interval == 30.0
        assert config.use_signed_definitions is True
        assert config.enable_variants is True
        assert config.connect_timeout == 5.0
        assert config.request_timeout == 15.0

    def test_config_strips_trailing_slash_from_base_url(self) -> None:
        """Test that trailing slashes are removed from base_url."""
        config = TogglyConfig(
            app_key="test-key",
            base_url="https://api.example.com/"
        )
        assert config.base_url == "https://api.example.com"

    def test_config_with_null_app_key(self) -> None:
        """Test config with null app key."""
        config = TogglyConfig(app_key=None)
        assert config.app_key is None

    def test_config_with_empty_app_key(self) -> None:
        """Test config with empty app key."""
        config = TogglyConfig(app_key="")
        assert config.app_key == ""

    def test_config_with_zero_refresh_interval(self) -> None:
        """Test config with zero refresh interval disables auto-refresh."""
        config = TogglyConfig(app_key="key", refresh_interval=0)
        assert config.refresh_interval == 0

    def test_config_with_negative_refresh_interval_raises(self) -> None:
        """Test that negative refresh interval raises ValueError."""
        with pytest.raises(ValueError, match="refresh_interval must be non-negative"):
            TogglyConfig(app_key="key", refresh_interval=-1)

    def test_config_with_invalid_connect_timeout_raises(self) -> None:
        """Test that non-positive connect timeout raises ValueError."""
        with pytest.raises(ValueError, match="connect_timeout must be positive"):
            TogglyConfig(app_key="key", connect_timeout=0)

    def test_config_with_invalid_request_timeout_raises(self) -> None:
        """Test that non-positive request timeout raises ValueError."""
        with pytest.raises(ValueError, match="request_timeout must be positive"):
            TogglyConfig(app_key="key", request_timeout=0)

    def test_config_feature_defaults_are_accessible(self) -> None:
        """Test feature defaults are accessible."""
        defaults = {"feature1": True, "feature2": False}
        config = TogglyConfig(app_key="key", feature_defaults=defaults)

        assert config.feature_defaults["feature1"] is True
        assert config.feature_defaults["feature2"] is False

    def test_config_with_app_key_method(self) -> None:
        """Test with_app_key creates new config."""
        original = TogglyConfig(app_key="original")
        copy = original.with_app_key("copied")

        assert original.app_key == "original"
        assert copy.app_key == "copied"

    def test_config_with_environment_method(self) -> None:
        """Test with_environment creates new config."""
        original = TogglyConfig(app_key="key", environment="Production")
        copy = original.with_environment("Staging")

        assert original.environment == "Production"
        assert copy.environment == "Staging"

    def test_config_with_defaults_method(self) -> None:
        """Test with_defaults merges defaults."""
        original = TogglyConfig(
            app_key="key",
            feature_defaults={"feature1": True}
        )
        copy = original.with_defaults({"feature2": False})

        assert original.feature_defaults == {"feature1": True}
        assert copy.feature_defaults == {"feature1": True, "feature2": False}

    def test_config_to_dict_masks_app_key(self) -> None:
        """Test to_dict masks the app key."""
        config = TogglyConfig(app_key="secret-key", enable_variants=True)
        config_dict = config.to_dict()

        assert config_dict["app_key"] == "***"
        assert config_dict["enable_variants"] is True

    def test_config_to_dict_shows_none_for_missing_app_key(self) -> None:
        """Test to_dict shows None for missing app key."""
        config = TogglyConfig(app_key=None)
        config_dict = config.to_dict()

        assert config_dict["app_key"] is None

    def test_config_with_various_environments(self) -> None:
        """Test config with various environment values."""
        environments = ["Development", "Staging", "Production", "Test"]

        for env in environments:
            config = TogglyConfig(app_key="key", environment=env)
            assert config.environment == env

    def test_config_with_special_characters_in_app_key(self) -> None:
        """Test config with special characters in app key."""
        special_key = "key-with_special.chars:123"
        config = TogglyConfig(app_key=special_key)
        assert config.app_key == special_key

    def test_config_base_url_variations(self) -> None:
        """Test config with various base URL values."""
        urls = [
            "https://api.toggly.io",
            "https://custom.domain.com",
            "http://localhost:3000",
            "https://api.toggly.io/v2",
        ]

        for url in urls:
            config = TogglyConfig(app_key="key", base_url=url)
            assert config.base_url == url.rstrip("/")

    def test_config_timeout_defaults(self) -> None:
        """Test config default timeout values."""
        config = TogglyConfig(app_key="key")
        assert config.connect_timeout == 10.0
        assert config.request_timeout == 30.0

    def test_config_definitions_url_defaults_to_base_url(self) -> None:
        """Test definitions URL defaults to base URL."""
        config = TogglyConfig(app_key="key", base_url="https://api.example.com")
        assert config.definitions_url == "https://api.example.com"

    def test_config_custom_definitions_url(self) -> None:
        """Test custom definitions URL."""
        config = TogglyConfig(
            app_key="key",
            base_url="https://api.example.com",
            definitions_url="https://definitions.example.com"
        )
        assert config.definitions_url == "https://definitions.example.com"

    def test_config_enable_usage_tracking_default(self) -> None:
        """Test usage tracking is enabled by default."""
        config = TogglyConfig(app_key="key")
        assert config.enable_usage_tracking is True

    def test_config_enable_metrics_default(self) -> None:
        """Test metrics is disabled by default."""
        config = TogglyConfig(app_key="key")
        assert config.enable_metrics is False

    def test_config_debug_default(self) -> None:
        """Test debug is disabled by default."""
        config = TogglyConfig(app_key="key")
        assert config.debug is False
