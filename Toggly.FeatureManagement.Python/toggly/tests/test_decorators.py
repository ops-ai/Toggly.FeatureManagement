"""Tests for feature flag decorators."""


from toggly import (
    EvaluationContext,
    FeatureRequirement,
    TogglyClient,
    TogglyConfig,
    feature_context,
    feature_flag,
    feature_gate,
    get_default_client,
    set_default_client,
)


class TestFeatureFlagDecorator:
    """Tests for @feature_flag decorator."""

    def test_decorator_with_enabled_feature(self) -> None:
        """Test decorator executes function when feature enabled."""
        config = TogglyConfig(feature_defaults={"my-feature": True})
        client = TogglyClient(config)
        client.init()

        @feature_flag("my-feature", client=client)
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "executed"

    def test_decorator_with_disabled_feature(self) -> None:
        """Test decorator returns default when feature disabled."""
        config = TogglyConfig(feature_defaults={"my-feature": False})
        client = TogglyClient(config)
        client.init()

        @feature_flag("my-feature", client=client, default="not executed")
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "not executed"

    def test_decorator_with_fallback(self) -> None:
        """Test decorator calls fallback when feature disabled."""
        config = TogglyConfig(feature_defaults={"my-feature": False})
        client = TogglyClient(config)
        client.init()

        def fallback_func() -> str:
            return "fallback executed"

        @feature_flag("my-feature", client=client, fallback=fallback_func)
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "fallback executed"

    def test_decorator_with_arguments(self) -> None:
        """Test decorator passes arguments to function."""
        config = TogglyConfig(feature_defaults={"my-feature": True})
        client = TogglyClient(config)
        client.init()

        @feature_flag("my-feature", client=client)
        def add(a: int, b: int) -> int:
            return a + b

        result = add(2, 3)
        assert result == 5

    def test_decorator_with_default_none(self) -> None:
        """Test decorator returns None by default when disabled."""
        config = TogglyConfig(feature_defaults={"my-feature": False})
        client = TogglyClient(config)
        client.init()

        @feature_flag("my-feature", client=client)
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result is None

    def test_decorator_no_client_executes_function(self) -> None:
        """Test decorator executes function when no client available."""
        # Clear any default client
        set_default_client(None)

        @feature_flag("my-feature")
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "executed"


class TestFeatureGateDecorator:
    """Tests for @feature_gate decorator."""

    def test_gate_all_enabled(self) -> None:
        """Test gate executes when all features enabled."""
        config = TogglyConfig(
            feature_defaults={"feature1": True, "feature2": True}
        )
        client = TogglyClient(config)
        client.init()

        @feature_gate(
            ["feature1", "feature2"],
            requirement=FeatureRequirement.ALL,
            client=client
        )
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "executed"

    def test_gate_all_one_disabled(self) -> None:
        """Test gate returns default when one feature disabled (ALL)."""
        config = TogglyConfig(
            feature_defaults={"feature1": True, "feature2": False}
        )
        client = TogglyClient(config)
        client.init()

        @feature_gate(
            ["feature1", "feature2"],
            requirement=FeatureRequirement.ALL,
            client=client,
            default="blocked"
        )
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "blocked"

    def test_gate_any_one_enabled(self) -> None:
        """Test gate executes when one feature enabled (ANY)."""
        config = TogglyConfig(
            feature_defaults={"feature1": False, "feature2": True}
        )
        client = TogglyClient(config)
        client.init()

        @feature_gate(
            ["feature1", "feature2"],
            requirement=FeatureRequirement.ANY,
            client=client
        )
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "executed"

    def test_gate_with_negate(self) -> None:
        """Test gate with negate."""
        config = TogglyConfig(feature_defaults={"feature1": True})
        client = TogglyClient(config)
        client.init()

        @feature_gate(
            ["feature1"],
            requirement=FeatureRequirement.ALL,
            negate=True,
            client=client,
            default="blocked"
        )
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "blocked"

    def test_gate_with_fallback(self) -> None:
        """Test gate with fallback function."""
        config = TogglyConfig(
            feature_defaults={"feature1": False, "feature2": False}
        )
        client = TogglyClient(config)
        client.init()

        def fallback() -> str:
            return "fallback"

        @feature_gate(
            ["feature1", "feature2"],
            requirement=FeatureRequirement.ANY,
            client=client,
            fallback=fallback
        )
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "fallback"


class TestFeatureContextFunction:
    """Tests for feature_context context manager function."""

    def test_feature_context_enabled(self) -> None:
        """Test feature_context yields True when enabled."""
        config = TogglyConfig(feature_defaults={"my-feature": True})
        client = TogglyClient(config)
        client.init()

        with feature_context("my-feature", client=client) as enabled:
            assert enabled is True

    def test_feature_context_disabled(self) -> None:
        """Test feature_context yields False when disabled."""
        config = TogglyConfig(feature_defaults={"my-feature": False})
        client = TogglyClient(config)
        client.init()

        with feature_context("my-feature", client=client) as enabled:
            assert enabled is False

    def test_feature_context_with_custom_context(self) -> None:
        """Test feature_context with custom evaluation context."""
        config = TogglyConfig(feature_defaults={"my-feature": True})
        client = TogglyClient(config)
        client.init()

        context = EvaluationContext(identity="user-123")
        with feature_context("my-feature", context=context, client=client) as enabled:
            assert enabled is True


class TestDefaultClient:
    """Tests for default client functionality."""

    def test_set_and_get_default_client(self) -> None:
        """Test setting and getting default client."""
        config = TogglyConfig()
        client = TogglyClient(config)

        set_default_client(client)

        assert get_default_client() is client

        # Clean up
        set_default_client(None)

    def test_decorator_uses_default_client(self) -> None:
        """Test decorator uses default client when not specified."""
        config = TogglyConfig(feature_defaults={"my-feature": True})
        client = TogglyClient(config)
        client.init()
        set_default_client(client)

        @feature_flag("my-feature")
        def my_function() -> str:
            return "executed"

        result = my_function()
        assert result == "executed"

        # Clean up
        set_default_client(None)

    def test_feature_context_uses_default_client(self) -> None:
        """Test feature_context uses default client when not specified."""
        config = TogglyConfig(feature_defaults={"my-feature": True})
        client = TogglyClient(config)
        client.init()
        set_default_client(client)

        with feature_context("my-feature") as enabled:
            assert enabled is True

        # Clean up
        set_default_client(None)


class TestDecoratorPreservesMetadata:
    """Tests for decorator metadata preservation."""

    def test_decorator_preserves_function_name(self) -> None:
        """Test decorator preserves function name."""
        config = TogglyConfig(feature_defaults={"my-feature": True})
        client = TogglyClient(config)

        @feature_flag("my-feature", client=client)
        def my_special_function() -> None:
            """My docstring."""
            pass

        assert my_special_function.__name__ == "my_special_function"
        assert my_special_function.__doc__ == "My docstring."

    def test_gate_decorator_preserves_function_name(self) -> None:
        """Test gate decorator preserves function name."""
        config = TogglyConfig(feature_defaults={"feature1": True})
        client = TogglyClient(config)

        @feature_gate(["feature1"], client=client)
        def another_function() -> None:
            """Another docstring."""
            pass

        assert another_function.__name__ == "another_function"
        assert another_function.__doc__ == "Another docstring."
