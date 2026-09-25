"""Tests for TogglyClient."""

from toggly import (
    Allocation,
    AsyncTogglyClient,
    EvaluationContext,
    FeatureDefinition,
    FeatureFilter,
    FeatureRequirement,
    LoadStatus,
    MemorySnapshotProvider,
    TogglyClient,
    TogglyConfig,
    UserAllocation,
    Variant,
)
from toggly.providers import DefinitionsSnapshot


class TestTogglyClientInitialization:
    """Tests for TogglyClient initialization."""

    def test_client_with_config(self) -> None:
        """Test client initialization with config."""
        config = TogglyConfig(app_key="test-key")
        client = TogglyClient(config)

        assert client.is_initialized is False
        assert client.current_identity is None

    def test_client_with_kwargs(self) -> None:
        """Test client initialization with kwargs."""
        client = TogglyClient(
            app_key="test-key",
            environment="Staging",
            feature_defaults={"feature1": True}
        )

        assert client.is_initialized is False
        assert client.feature_flags.get("feature1") is True

    def test_client_default_flags(self) -> None:
        """Test client uses default flags."""
        config = TogglyConfig(
            feature_defaults={"feature1": True, "feature2": False}
        )
        client = TogglyClient(config)

        assert client.feature_flags["feature1"] is True
        assert client.feature_flags["feature2"] is False

    def test_client_with_identity(self) -> None:
        """Test client with initial identity."""
        config = TogglyConfig(identity="user-123")
        client = TogglyClient(config)

        assert client.current_identity == "user-123"


class TestTogglyClientEvaluation:
    """Tests for TogglyClient feature evaluation."""

    def test_is_enabled_with_defaults(self) -> None:
        """Test is_enabled uses defaults when no definitions."""
        config = TogglyConfig(
            feature_defaults={"feature1": True, "feature2": False}
        )
        client = TogglyClient(config)

        assert client.is_enabled("feature1") is True
        assert client.is_enabled("feature2") is False

    def test_is_enabled_unknown_feature(self) -> None:
        """Test is_enabled returns False for unknown feature."""
        client = TogglyClient()

        assert client.is_enabled("unknown-feature") is False

    def test_is_enabled_with_default_value(self) -> None:
        """Test is_enabled uses provided default."""
        client = TogglyClient()

        assert client.is_enabled("unknown", default=True) is True
        assert client.is_enabled("unknown", default=False) is False

    def test_is_disabled(self) -> None:
        """Test is_disabled is opposite of is_enabled."""
        config = TogglyConfig(
            feature_defaults={"enabled": True, "disabled": False}
        )
        client = TogglyClient(config)

        assert client.is_disabled("enabled") is False
        assert client.is_disabled("disabled") is True

    def test_is_disabled_unknown_feature(self) -> None:
        """Test is_disabled returns True for unknown feature."""
        client = TogglyClient()

        assert client.is_disabled("unknown-feature") is True

    def test_evaluate_with_context(self) -> None:
        """Test evaluation with custom context."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="targeted-feature",
                    filters=[
                        FeatureFilter(
                            name="Targeting",
                            parameters={"users": "special-user"}
                        )
                    ]
                )
            ]
        ))

        config = TogglyConfig(snapshot_provider=provider)
        client = TogglyClient(config)
        client.init()

        # Regular user - not enabled
        regular_context = EvaluationContext(identity="regular-user")
        assert client.is_enabled("targeted-feature", regular_context) is False

        # Special user - enabled
        special_context = EvaluationContext(identity="special-user")
        assert client.is_enabled("targeted-feature", special_context) is True


class TestTogglyClientGate:
    """Tests for TogglyClient gate evaluation."""

    def test_evaluate_gate_all_requirement(self) -> None:
        """Test evaluate_gate with ALL requirement."""
        config = TogglyConfig(
            feature_defaults={"feature1": True, "feature2": True}
        )
        client = TogglyClient(config)

        result = client.evaluate_gate(
            ["feature1", "feature2"],
            FeatureRequirement.ALL
        )
        assert result is True

    def test_evaluate_gate_all_with_one_disabled(self) -> None:
        """Test evaluate_gate ALL with one disabled."""
        config = TogglyConfig(
            feature_defaults={"feature1": True, "feature2": False}
        )
        client = TogglyClient(config)

        result = client.evaluate_gate(
            ["feature1", "feature2"],
            FeatureRequirement.ALL
        )
        assert result is False

    def test_evaluate_gate_any_requirement(self) -> None:
        """Test evaluate_gate with ANY requirement."""
        config = TogglyConfig(
            feature_defaults={"feature1": False, "feature2": True}
        )
        client = TogglyClient(config)

        result = client.evaluate_gate(
            ["feature1", "feature2"],
            FeatureRequirement.ANY
        )
        assert result is True

    def test_evaluate_gate_any_all_disabled(self) -> None:
        """Test evaluate_gate ANY with all disabled."""
        config = TogglyConfig(
            feature_defaults={"feature1": False, "feature2": False}
        )
        client = TogglyClient(config)

        result = client.evaluate_gate(
            ["feature1", "feature2"],
            FeatureRequirement.ANY
        )
        assert result is False

    def test_evaluate_gate_with_negate(self) -> None:
        """Test evaluate_gate with negate."""
        config = TogglyConfig(
            feature_defaults={"feature1": True}
        )
        client = TogglyClient(config)

        result = client.evaluate_gate(
            ["feature1"],
            FeatureRequirement.ALL,
            negate=True
        )
        assert result is False

    def test_evaluate_gate_empty_list(self) -> None:
        """Test evaluate_gate with empty list returns True."""
        client = TogglyClient()

        result = client.evaluate_gate([], FeatureRequirement.ALL)
        assert result is True


class TestTogglyClientInit:
    """Tests for TogglyClient init method."""

    def test_init_with_defaults_only(self) -> None:
        """Test init with defaults only (no app key)."""
        config = TogglyConfig(
            feature_defaults={"feature1": True}
        )
        client = TogglyClient(config)

        response = client.init()

        assert response.status == LoadStatus.DEFAULTS
        assert response.flags["feature1"] is True
        assert client.is_initialized is True

    def test_init_with_cached_data(self) -> None:
        """Test init with cached data."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="cached-feature",
                    filters=[FeatureFilter(name="AlwaysOn")]
                )
            ]
        ))

        config = TogglyConfig(snapshot_provider=provider)
        client = TogglyClient(config)

        response = client.init()

        assert response.status == LoadStatus.CACHED
        assert client.is_enabled("cached-feature") is True
        assert client.is_initialized is True


class TestTogglyClientIdentity:
    """Tests for TogglyClient identity management."""

    def test_set_identity(self) -> None:
        """Test setting identity."""
        client = TogglyClient()
        client.init()

        response = client.set_identity("user-123")

        assert client.current_identity == "user-123"
        assert response.status == LoadStatus.DEFAULTS

    def test_clear_identity(self) -> None:
        """Test clearing identity."""
        config = TogglyConfig(identity="user-123")
        client = TogglyClient(config)
        client.init()

        client.set_identity(None)

        assert client.current_identity is None


class TestTogglyClientFeatureState:
    """Tests for TogglyClient feature state."""

    def test_get_feature_state(self) -> None:
        """Test get_feature_state returns state info."""
        config = TogglyConfig(feature_defaults={"feature1": True})
        client = TogglyClient(config)
        client.init()

        state = client.get_feature_state("feature1")

        assert state.feature_key == "feature1"
        assert state.enabled is True
        assert state.source == LoadStatus.DEFAULTS
        assert state.evaluated_at is not None


class TestTogglyClientDebugInfo:
    """Tests for TogglyClient debug info."""

    def test_get_debug_info(self) -> None:
        """Test get_debug_info returns current state."""
        config = TogglyConfig(
            app_key="test-key",
            environment="staging",
            identity="user-123"
        )
        client = TogglyClient(config)
        client.init()

        info = client.get_debug_info()

        assert info.app_key == "test-key"
        assert info.environment == "staging"
        assert info.identity == "user-123"
        assert info.is_initialized is True


class TestTogglyClientContextManager:
    """Tests for TogglyClient context manager."""

    def test_context_manager(self) -> None:
        """Test using client as context manager."""
        config = TogglyConfig(feature_defaults={"feature1": True})

        with TogglyClient(config) as client:
            client.init()
            assert client.is_enabled("feature1") is True

    def test_feature_context(self) -> None:
        """Test feature_context method."""
        config = TogglyConfig(feature_defaults={"feature1": True})
        client = TogglyClient(config)
        client.init()

        with client.feature_context("feature1") as enabled:
            assert enabled is True


class TestTogglyClientClearCache:
    """Tests for TogglyClient cache clearing."""

    def test_clear_cache(self) -> None:
        """Test clear_cache removes cached data."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(feature_key="cached-feature")
            ]
        ))

        config = TogglyConfig(snapshot_provider=provider)
        client = TogglyClient(config)
        client.init()

        client.clear_cache()

        # Provider should be cleared
        assert provider.load_definitions() is None


class TestTogglyClientRegistry:
    """Tests for TogglyClient evaluator registry."""

    def test_registry_accessible(self) -> None:
        """Test evaluator registry is accessible."""
        client = TogglyClient()

        assert client.registry is not None
        assert client.registry.get("AlwaysOn") is not None

    def test_register_custom_evaluator(self) -> None:
        """Test registering custom evaluator."""
        from toggly.evaluator import AlwaysOnEvaluator

        client = TogglyClient()
        custom_evaluator = AlwaysOnEvaluator()

        client.registry.register("Custom", custom_evaluator)

        assert client.registry.get("Custom") is custom_evaluator


class TestTogglyClientVariants:
    """Tests for catalog-local variant assignment (get_variant / get_variant_value)."""

    def _client_with_variant_feature(self) -> TogglyClient:
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="checkout-flow",
                    filters=[FeatureFilter(name="AlwaysOn")],
                    variants=[
                        Variant(name="A", configuration_value={"color": "blue"}),
                        Variant(name="B", configuration_value={"color": "green"}),
                    ],
                    allocation=Allocation(
                        default_when_enabled="B",
                        user=[UserAllocation(variant="A", users=["alice"])],
                    ),
                )
            ]
        ))
        client = TogglyClient(TogglyConfig(snapshot_provider=provider))
        client.init()
        return client

    def test_get_variant_user_match(self) -> None:
        """User allocation match returns the targeted variant."""
        client = self._client_with_variant_feature()
        try:
            v = client.get_variant("checkout-flow", user_id="alice")
            assert v is not None
            assert v.name == "A"
            assert v.configuration_value == {"color": "blue"}
            assert v.enabled is True
            assert v.assignment_reason == "User"
            assert client.get_variant_value("checkout-flow", user_id="alice") == {
                "color": "blue"
            }
        finally:
            client.close()

    def test_get_variant_value_typed_object(self) -> None:
        """Typed object bind returns a dataclass instance on shape match."""
        from dataclasses import dataclass

        @dataclass
        class CheckoutConfig:
            color: str

        client = self._client_with_variant_feature()
        try:
            typed = client.get_variant_value(
                "checkout-flow", user_id="alice", type=CheckoutConfig
            )
            assert typed == CheckoutConfig(color="blue")
        finally:
            client.close()

    def test_get_variant_value_typed_scalar(self) -> None:
        """Typed scalar bind returns the value when types match."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="banner",
                    filters=[FeatureFilter(name="AlwaysOn")],
                    variants=[Variant(name="A", configuration_value="hello")],
                    allocation=Allocation(default_when_enabled="A"),
                )
            ]
        ))
        client = TogglyClient(TogglyConfig(snapshot_provider=provider))
        client.init()
        try:
            assert client.get_variant_value("banner", type=str) == "hello"
        finally:
            client.close()

    def test_get_variant_value_typed_mismatch_returns_none(self) -> None:
        """Shape mismatch soft-returns None (never a wrong-typed value)."""
        client = self._client_with_variant_feature()
        try:
            assert client.get_variant_value(
                "checkout-flow", user_id="alice", type=str
            ) is None
            # Object config + primitive type must not call int()/str() defaults.
            assert client.get_variant_value(
                "checkout-flow", user_id="alice", type=int
            ) is None
        finally:
            client.close()

    def test_get_variant_value_typed_missing_returns_none(self) -> None:
        """Missing assignment soft-returns None for typed access."""
        client = TogglyClient()
        assert client.get_variant_value("unknown", type=str) is None

    def test_get_variant_falls_back_to_default_when_enabled(self) -> None:
        """No user/group/percentile match falls back to defaultWhenEnabled."""
        client = self._client_with_variant_feature()
        try:
            v = client.get_variant("checkout-flow", user_id="bob")
            assert v is not None
            assert v.name == "B"
            assert v.assignment_reason == "DefaultWhenEnabled"
        finally:
            client.close()

    def test_get_variant_uses_client_identity_when_user_id_omitted(self) -> None:
        """Omitting user_id falls back to the client's current identity."""
        client = self._client_with_variant_feature()
        try:
            client.set_identity("alice")
            v = client.get_variant("checkout-flow")
            assert v is not None
            assert v.name == "A"
        finally:
            client.close()

    def test_get_variant_none_for_unknown_feature(self) -> None:
        """Unknown feature key returns None."""
        client = TogglyClient()
        assert client.get_variant("unknown") is None
        assert client.get_variant_value("unknown") is None

    def test_get_variant_none_when_feature_has_no_variants(self) -> None:
        """A feature definition without variants returns None."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="plain-flag", filters=[FeatureFilter(name="AlwaysOn")]
                )
            ]
        ))
        client = TogglyClient(TogglyConfig(snapshot_provider=provider))
        client.init()
        try:
            assert client.get_variant("plain-flag") is None
        finally:
            client.close()

    def test_get_variant_status_override_flips_effective_enabled(self) -> None:
        """A statusOverride on the assigned variant flips VariantResult.enabled."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="kill-switch",
                    filters=[FeatureFilter(name="AlwaysOn")],
                    variants=[Variant(name="On", status_override="Disabled")],
                    allocation=Allocation(default_when_enabled="On"),
                )
            ]
        ))
        client = TogglyClient(TogglyConfig(snapshot_provider=provider))
        client.init()
        try:
            # is_enabled stays filter-based (does not apply StatusOverride).
            assert client.is_enabled("kill-switch") is True
            v = client.get_variant("kill-switch")
            assert v is not None
            assert v.name == "On"
            assert v.enabled is False
        finally:
            client.close()


class TestAsyncTogglyClientVariants:
    """Tests for catalog-local variant assignment on AsyncTogglyClient."""

    async def test_get_variant_user_match(self) -> None:
        """User allocation match returns the targeted variant (async)."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="checkout-flow",
                    filters=[FeatureFilter(name="AlwaysOn")],
                    variants=[
                        Variant(name="A", configuration_value={"color": "blue"}),
                        Variant(name="B", configuration_value={"color": "green"}),
                    ],
                    allocation=Allocation(
                        default_when_enabled="B",
                        user=[UserAllocation(variant="A", users=["alice"])],
                    ),
                )
            ]
        ))
        client = AsyncTogglyClient(TogglyConfig(snapshot_provider=provider))
        await client.init()
        try:
            v = await client.get_variant("checkout-flow", user_id="alice")
            assert v is not None
            assert v.name == "A"
            assert v.assignment_reason == "User"

            v2 = await client.get_variant("checkout-flow", user_id="bob")
            assert v2 is not None
            assert v2.name == "B"
            assert v2.assignment_reason == "DefaultWhenEnabled"

            value = await client.get_variant_value("checkout-flow", user_id="alice")
            assert value == {"color": "blue"}

            from dataclasses import dataclass

            @dataclass
            class CheckoutConfig:
                color: str

            typed = await client.get_variant_value(
                "checkout-flow", user_id="alice", type=CheckoutConfig
            )
            assert typed == CheckoutConfig(color="blue")
            assert (
                await client.get_variant_value(
                    "checkout-flow", user_id="alice", type=str
                )
                is None
            )
        finally:
            await client.close()

    async def test_get_variant_value_typed_missing_returns_none(self) -> None:
        """Missing assignment soft-returns None for typed async access."""
        client = AsyncTogglyClient()
        assert await client.get_variant_value("unknown", type=dict) is None

    async def test_get_variant_none_for_unknown_feature(self) -> None:
        """Unknown feature key returns None (async)."""
        client = AsyncTogglyClient()
        assert await client.get_variant("unknown") is None
        assert await client.get_variant_value("unknown") is None
