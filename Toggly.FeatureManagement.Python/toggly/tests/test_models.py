"""Tests for Toggly models."""

import pytest
from datetime import datetime, timezone

from toggly import (
    FeatureDefinition,
    FeatureFilter,
    FeatureState,
    TogglyInitResponse,
    LoadStatus,
    DebugInfo,
    NetworkState,
    JsonWebKey,
    JsonWebKeySet,
)


class TestFeatureFilter:
    """Tests for FeatureFilter class."""

    def test_filter_creation(self) -> None:
        """Test basic filter creation."""
        filter_ = FeatureFilter(name="AlwaysOn")

        assert filter_.name == "AlwaysOn"
        assert filter_.parameters == {}

    def test_filter_with_parameters(self) -> None:
        """Test filter with parameters."""
        filter_ = FeatureFilter(
            name="Percentage",
            parameters={"Value": 50}
        )

        assert filter_.name == "Percentage"
        assert filter_.parameters == {"Value": 50}

    def test_filter_with_empty_name_raises(self) -> None:
        """Test that empty filter name raises ValueError."""
        with pytest.raises(ValueError, match="Filter name cannot be empty"):
            FeatureFilter(name="")

    def test_filter_with_complex_parameters(self) -> None:
        """Test filter with complex parameters."""
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={
                "users": "user1,user2",
                "groups": "beta,admin",
                "DefaultRolloutPercentage": 25
            }
        )

        assert filter_.parameters["users"] == "user1,user2"
        assert filter_.parameters["DefaultRolloutPercentage"] == 25


class TestFeatureDefinition:
    """Tests for FeatureDefinition class."""

    def test_definition_minimal(self) -> None:
        """Test minimal definition creation."""
        definition = FeatureDefinition(feature_key="my-feature")

        assert definition.feature_key == "my-feature"
        assert definition.filters == []
        assert definition.requirement_type == "Any"
        assert definition.secured_feature is False
        assert definition.metrics is None

    def test_definition_with_filters(self) -> None:
        """Test definition with filters."""
        filters = [
            FeatureFilter(name="AlwaysOn"),
            FeatureFilter(name="Percentage", parameters={"Value": 50})
        ]
        definition = FeatureDefinition(
            feature_key="my-feature",
            filters=filters
        )

        assert len(definition.filters) == 2
        assert definition.filters[0].name == "AlwaysOn"

    def test_definition_with_all_requirement(self) -> None:
        """Test definition with ALL requirement."""
        definition = FeatureDefinition(
            feature_key="my-feature",
            requirement_type="All"
        )

        assert definition.requirement_type == "All"

    def test_definition_with_empty_key_raises(self) -> None:
        """Test that empty feature key raises ValueError."""
        with pytest.raises(ValueError, match="Feature key cannot be empty"):
            FeatureDefinition(feature_key="")

    def test_definition_with_invalid_requirement_raises(self) -> None:
        """Test that invalid requirement type raises ValueError."""
        with pytest.raises(ValueError, match="Requirement type must be 'Any' or 'All'"):
            FeatureDefinition(feature_key="test", requirement_type="Invalid")

    def test_definition_with_secured_feature(self) -> None:
        """Test definition with secured feature."""
        definition = FeatureDefinition(
            feature_key="my-feature",
            secured_feature=True
        )

        assert definition.secured_feature is True

    def test_definition_with_metrics(self) -> None:
        """Test definition with metrics."""
        definition = FeatureDefinition(
            feature_key="my-feature",
            metrics=["metric1", "metric2"]
        )

        assert definition.metrics == ["metric1", "metric2"]


class TestFeatureState:
    """Tests for FeatureState class."""

    def test_state_creation(self) -> None:
        """Test feature state creation."""
        state = FeatureState(
            feature_key="my-feature",
            enabled=True
        )

        assert state.feature_key == "my-feature"
        assert state.enabled is True
        assert state.source == LoadStatus.DEFAULTS
        assert state.evaluated_at is None
        assert state.metadata == {}

    def test_state_with_all_fields(self) -> None:
        """Test feature state with all fields."""
        now = datetime.now(timezone.utc)
        state = FeatureState(
            feature_key="my-feature",
            enabled=False,
            source=LoadStatus.FETCHED,
            evaluated_at=now,
            metadata={"filter_count": 2}
        )

        assert state.feature_key == "my-feature"
        assert state.enabled is False
        assert state.source == LoadStatus.FETCHED
        assert state.evaluated_at == now
        assert state.metadata == {"filter_count": 2}


class TestTogglyInitResponse:
    """Tests for TogglyInitResponse class."""

    def test_response_minimal(self) -> None:
        """Test minimal response creation."""
        response = TogglyInitResponse(status=LoadStatus.DEFAULTS)

        assert response.status == LoadStatus.DEFAULTS
        assert response.flags == {}
        assert response.definitions == []
        assert response.error is None
        assert response.etag is None
        assert response.timestamp is None

    def test_response_with_flags(self) -> None:
        """Test response with flags."""
        flags = {"feature1": True, "feature2": False}
        response = TogglyInitResponse(
            status=LoadStatus.FETCHED,
            flags=flags
        )

        assert response.status == LoadStatus.FETCHED
        assert response.flags == flags

    def test_response_with_error(self) -> None:
        """Test response with error."""
        response = TogglyInitResponse(
            status=LoadStatus.ERROR,
            error="Network error"
        )

        assert response.status == LoadStatus.ERROR
        assert response.error == "Network error"

    def test_response_with_etag(self) -> None:
        """Test response with ETag."""
        response = TogglyInitResponse(
            status=LoadStatus.CACHED,
            etag="abc123"
        )

        assert response.etag == "abc123"


class TestNetworkState:
    """Tests for NetworkState class."""

    def test_network_state_connected(self) -> None:
        """Test connected network state."""
        state = NetworkState(is_connected=True, connection_type="wifi")

        assert state.is_connected is True
        assert state.connection_type == "wifi"

    def test_network_state_disconnected(self) -> None:
        """Test disconnected network state."""
        state = NetworkState(is_connected=False)

        assert state.is_connected is False
        assert state.connection_type is None


class TestDebugInfo:
    """Tests for DebugInfo class."""

    def test_debug_info_creation(self) -> None:
        """Test debug info creation."""
        info = DebugInfo(
            identity="user-123",
            app_key="test-key",
            environment="staging",
            base_url="https://api.toggly.io",
            use_signed_definitions=False,
            refresh_interval=180.0,
            last_refresh=None,
            last_error=None,
            etag=None,
            feature_count=5,
            is_initialized=True
        )

        assert info.identity == "user-123"
        assert info.app_key == "test-key"
        assert info.environment == "staging"
        assert info.feature_count == 5
        assert info.is_initialized is True


class TestJsonWebKey:
    """Tests for JsonWebKey class."""

    def test_jwk_creation(self) -> None:
        """Test JWK creation."""
        jwk = JsonWebKey(
            kty="EC",
            kid="key-1",
            crv="P-256",
            x="base64x",
            y="base64y"
        )

        assert jwk.kty == "EC"
        assert jwk.kid == "key-1"
        assert jwk.crv == "P-256"
        assert jwk.x == "base64x"
        assert jwk.y == "base64y"
        assert jwk.alg == "ES256"
        assert jwk.use == "sig"


class TestJsonWebKeySet:
    """Tests for JsonWebKeySet class."""

    def test_jwks_empty(self) -> None:
        """Test empty JWKS."""
        jwks = JsonWebKeySet()

        assert jwks.keys == []
        assert jwks.get_key("any") is None

    def test_jwks_with_keys(self) -> None:
        """Test JWKS with keys."""
        key1 = JsonWebKey(kty="EC", kid="key-1", crv="P-256", x="x1", y="y1")
        key2 = JsonWebKey(kty="EC", kid="key-2", crv="P-256", x="x2", y="y2")
        jwks = JsonWebKeySet(keys=[key1, key2])

        assert len(jwks.keys) == 2
        assert jwks.get_key("key-1") == key1
        assert jwks.get_key("key-2") == key2
        assert jwks.get_key("key-3") is None
