"""Tests for Toggly models."""

from datetime import datetime, timezone

import pytest

from toggly import (
    Allocation,
    DebugInfo,
    FeatureDefinition,
    FeatureFilter,
    FeatureState,
    GroupAllocation,
    JsonWebKey,
    JsonWebKeySet,
    LoadStatus,
    NetworkState,
    PercentileAllocation,
    TogglyInitResponse,
    UserAllocation,
    Variant,
    VariantResult,
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

    def test_definition_with_variants_and_allocation(self) -> None:
        """Test definition carries variants + allocation."""
        definition = FeatureDefinition(
            feature_key="my-feature",
            variants=[Variant(name="A"), Variant(name="B")],
            allocation=Allocation(default_when_enabled="A"),
        )

        assert [v.name for v in definition.variants] == ["A", "B"]
        assert definition.allocation is not None
        assert definition.allocation.default_when_enabled == "A"

    def test_definition_to_dict_from_dict_roundtrip_with_variants(self) -> None:
        """Test to_dict/from_dict preserves variants + allocation."""
        definition = FeatureDefinition(
            feature_key="my-feature",
            variants=[
                Variant(name="A", configuration_value={"x": 1}, status_override="Enabled")
            ],
            allocation=Allocation(
                default_when_enabled="A",
                default_when_disabled="B",
                seed="my-seed",
                user=[UserAllocation(variant="A", users=["u1"])],
                group=[GroupAllocation(variant="A", groups=["g1"])],
                percentile=[PercentileAllocation(variant="A", from_=0, to=50)],
            ),
        )

        restored = FeatureDefinition.from_dict(definition.to_dict())

        assert len(restored.variants) == 1
        assert restored.variants[0].name == "A"
        assert restored.variants[0].configuration_value == {"x": 1}
        assert restored.variants[0].status_override == "Enabled"
        assert restored.allocation is not None
        assert restored.allocation.default_when_enabled == "A"
        assert restored.allocation.default_when_disabled == "B"
        assert restored.allocation.seed == "my-seed"
        assert restored.allocation.user[0].users == ["u1"]
        assert restored.allocation.group[0].groups == ["g1"]
        assert restored.allocation.percentile[0].from_ == 0
        assert restored.allocation.percentile[0].to == 50

    def test_definition_defaults_to_no_variants(self) -> None:
        """Test definition defaults to empty variants / no allocation."""
        definition = FeatureDefinition(feature_key="my-feature")

        assert definition.variants == []
        assert definition.allocation is None


class TestVariant:
    """Tests for Variant class."""

    def test_variant_defaults(self) -> None:
        """Test variant default status override."""
        variant = Variant(name="A")
        assert variant.name == "A"
        assert variant.configuration_value is None
        assert variant.status_override == "None"

    def test_variant_from_dict_camel_case(self) -> None:
        """Test parsing camelCase wire keys."""
        variant = Variant.from_dict(
            {"name": "A", "configurationValue": {"x": 1}, "statusOverride": "Enabled"}
        )
        assert variant is not None
        assert variant.name == "A"
        assert variant.configuration_value == {"x": 1}
        assert variant.status_override == "Enabled"

    def test_variant_from_dict_defaults_status_override(self) -> None:
        """Test missing statusOverride defaults to None."""
        variant = Variant.from_dict({"name": "A"})
        assert variant is not None
        assert variant.status_override == "None"


class TestAllocation:
    """Tests for Allocation class."""

    def test_allocation_from_dict_none_when_absent(self) -> None:
        """Test Allocation.from_dict returns None for falsy input."""
        assert Allocation.from_dict(None) is None
        assert Allocation.from_dict({}) is None

    def test_allocation_from_dict_full(self) -> None:
        """Test parsing a fully populated allocation."""
        allocation = Allocation.from_dict(
            {
                "defaultWhenEnabled": "A",
                "defaultWhenDisabled": "B",
                "seed": "s1",
                "user": [{"variant": "A", "users": ["u1", "u2"]}],
                "group": [{"variant": "B", "groups": ["g1"]}],
                "percentile": [{"variant": "A", "from": 0, "to": 50}],
            }
        )
        assert allocation is not None
        assert allocation.default_when_enabled == "A"
        assert allocation.default_when_disabled == "B"
        assert allocation.seed == "s1"
        assert allocation.user[0].variant == "A"
        assert allocation.user[0].users == ["u1", "u2"]
        assert allocation.group[0].groups == ["g1"]
        assert allocation.percentile[0].from_ == 0
        assert allocation.percentile[0].to == 50

    def test_percentile_from_dict_preserves_zero_to_boundary(self) -> None:
        """``to: 0`` must not be coerced to 100 via truthiness."""
        alloc = PercentileAllocation.from_dict({"variant": "A", "from": 0, "to": 0})
        assert alloc is not None
        assert alloc.from_ == 0.0
        assert alloc.to == 0.0

    def test_variant_from_dict_skips_missing_name(self) -> None:
        """Malformed variant rows are skipped instead of raising KeyError."""
        assert Variant.from_dict({}) is None
        assert Variant.from_dict({"configurationValue": 1}) is None

    def test_allocation_from_dict_skips_entries_missing_variant(self) -> None:
        """Allocation rows without ``variant`` are skipped."""
        allocation = Allocation.from_dict(
            {
                "user": [{"users": ["alice"]}],
                "group": [{"groups": ["beta"]}],
                "percentile": [{"from": 0, "to": 50}],
            }
        )
        assert allocation is not None
        assert allocation.user == []
        assert allocation.group == []
        assert allocation.percentile == []

    def test_allocation_from_dict_missing_lists_default_empty(self) -> None:
        """Test missing user/group/percentile default to empty lists."""
        allocation = Allocation.from_dict({"defaultWhenEnabled": "A"})
        assert allocation is not None
        assert allocation.user == []
        assert allocation.group == []
        assert allocation.percentile == []


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


class TestVariantResult:
    """Tests for VariantResult."""

    def test_variant_result_fields(self) -> None:
        """Basic construction."""
        vr = VariantResult(name="a", configuration_value="x")
        assert vr.name == "a"
        assert vr.configuration_value == "x"
        assert vr.enabled is True
        assert vr.assignment_reason == "None"

    def test_variant_result_with_reason_and_enabled(self) -> None:
        """Construction with explicit reason / effective-enabled fields."""
        vr = VariantResult(
            name="B",
            configuration_value=42,
            enabled=False,
            assignment_reason="DefaultWhenEnabled",
        )
        assert vr.enabled is False
        assert vr.assignment_reason == "DefaultWhenEnabled"


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
