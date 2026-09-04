"""Tests for feature flag evaluation."""

import pytest
from datetime import datetime, timezone, timedelta

from toggly import (
    EvaluationContext,
    FeatureDefinition,
    FeatureFilter,
    FeatureRequirement,
)
from toggly.evaluator import (
    EvaluationEngine,
    EvaluatorRegistry,
    AlwaysOnEvaluator,
    PercentageEvaluator,
    TimeWindowEvaluator,
    TargetingEvaluator,
)


class TestAlwaysOnEvaluator:
    """Tests for AlwaysOn filter evaluator."""

    def test_always_returns_true(self) -> None:
        """Test AlwaysOn always returns True."""
        evaluator = AlwaysOnEvaluator()
        filter_ = FeatureFilter(name="AlwaysOn")
        context = EvaluationContext()

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_ignores_context(self) -> None:
        """Test AlwaysOn ignores context."""
        evaluator = AlwaysOnEvaluator()
        filter_ = FeatureFilter(name="AlwaysOn")
        context = EvaluationContext(identity="user-123", groups=["beta"])

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True


class TestPercentageEvaluator:
    """Tests for Percentage filter evaluator."""

    def test_zero_percentage_returns_false(self) -> None:
        """Test 0% returns False."""
        evaluator = PercentageEvaluator()
        filter_ = FeatureFilter(name="Percentage", parameters={"Value": 0})
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is False

    def test_hundred_percentage_returns_true(self) -> None:
        """Test 100% returns True."""
        evaluator = PercentageEvaluator()
        filter_ = FeatureFilter(name="Percentage", parameters={"Value": 100})
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_no_identity_returns_false(self) -> None:
        """Test missing identity returns False."""
        evaluator = PercentageEvaluator()
        filter_ = FeatureFilter(name="Percentage", parameters={"Value": 50})
        context = EvaluationContext()

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is False

    def test_deterministic_for_same_identity(self) -> None:
        """Test same identity always gets same result."""
        evaluator = PercentageEvaluator()
        filter_ = FeatureFilter(name="Percentage", parameters={"Value": 50})
        context = EvaluationContext(identity="user-123")

        results = [
            evaluator.evaluate(filter_, "test-feature", context)
            for _ in range(10)
        ]

        # All results should be the same
        assert len(set(results)) == 1

    def test_different_features_may_have_different_results(self) -> None:
        """Test different features may hash differently."""
        evaluator = PercentageEvaluator()
        filter_ = FeatureFilter(name="Percentage", parameters={"Value": 50})
        context = EvaluationContext(identity="user-123")

        results = []
        for i in range(100):
            result = evaluator.evaluate(filter_, f"feature-{i}", context)
            results.append(result)

        # With 50% rollout over 100 features, we should see both True and False
        assert True in results
        assert False in results

    def test_supports_percentage_parameter_name(self) -> None:
        """Test supports 'Percentage' parameter name."""
        evaluator = PercentageEvaluator()
        filter_ = FeatureFilter(name="Percentage", parameters={"Percentage": 100})
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_supports_lowercase_percentage(self) -> None:
        """Test supports lowercase 'percentage' parameter."""
        evaluator = PercentageEvaluator()
        filter_ = FeatureFilter(name="Percentage", parameters={"percentage": 100})
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_sha256_bucket_consistency(self) -> None:
        """Test SHA-256 sticky buckets are deterministic and Definitions-aligned."""
        from toggly.evaluator import compute_percentile

        bucket1 = compute_percentile("user-123", "test-feature")
        bucket2 = compute_percentile("user-123", "test-feature")
        assert bucket1 == bucket2
        assert 0 <= bucket1 < 100

        bucket3 = compute_percentile("other-user", "test-feature")
        assert bucket1 != bucket3


class TestTimeWindowEvaluator:
    """Tests for TimeWindow filter evaluator."""

    def test_no_time_constraints_returns_true(self) -> None:
        """Test no time constraints returns True."""
        evaluator = TimeWindowEvaluator()
        filter_ = FeatureFilter(name="TimeWindow")
        context = EvaluationContext()

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_before_start_returns_false(self) -> None:
        """Test before start time returns False."""
        evaluator = TimeWindowEvaluator()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        filter_ = FeatureFilter(name="TimeWindow", parameters={"Start": future})
        context = EvaluationContext()

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is False

    def test_after_end_returns_false(self) -> None:
        """Test after end time returns False."""
        evaluator = TimeWindowEvaluator()
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        filter_ = FeatureFilter(name="TimeWindow", parameters={"End": past})
        context = EvaluationContext()

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is False

    def test_within_window_returns_true(self) -> None:
        """Test within time window returns True."""
        evaluator = TimeWindowEvaluator()
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        filter_ = FeatureFilter(
            name="TimeWindow",
            parameters={"Start": past, "End": future}
        )
        context = EvaluationContext()

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_handles_z_suffix(self) -> None:
        """Test handles Z suffix in ISO dates."""
        evaluator = TimeWindowEvaluator()
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        filter_ = FeatureFilter(name="TimeWindow", parameters={"Start": past})
        context = EvaluationContext()

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True


class TestTargetingEvaluator:
    """Tests for Targeting filter evaluator."""

    def test_user_in_list_returns_true(self) -> None:
        """Test user in target list returns True."""
        evaluator = TargetingEvaluator()
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={"users": "user-123,user-456"}
        )
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_user_not_in_list_returns_false(self) -> None:
        """Test user not in target list returns False (with no default)."""
        evaluator = TargetingEvaluator()
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={"users": "user-456,user-789"}
        )
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is False

    def test_group_in_list_returns_true(self) -> None:
        """Test group in target list returns True."""
        evaluator = TargetingEvaluator()
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={"groups": "beta,premium"}
        )
        context = EvaluationContext(groups=["beta"])

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_group_not_in_list_returns_false(self) -> None:
        """Test group not in target list returns False."""
        evaluator = TargetingEvaluator()
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={"groups": "beta,premium"}
        )
        context = EvaluationContext(groups=["alpha"])

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is False

    def test_default_rollout_percentage(self) -> None:
        """Test default rollout percentage."""
        evaluator = TargetingEvaluator()
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={"DefaultRolloutPercentage": 100}
        )
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_indexed_users_format(self) -> None:
        """Test indexed Audience.Users:N format."""
        evaluator = TargetingEvaluator()
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={
                "Audience.Users:0": "user-123",
                "Audience.Users:1": "user-456"
            }
        )
        context = EvaluationContext(identity="user-123")

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True

    def test_indexed_groups_format(self) -> None:
        """Test indexed Audience.Groups:N format."""
        evaluator = TargetingEvaluator()
        filter_ = FeatureFilter(
            name="Targeting",
            parameters={
                "Audience.Groups:0": "beta",
                "Audience.Groups:1": "premium"
            }
        )
        context = EvaluationContext(groups=["premium"])

        result = evaluator.evaluate(filter_, "test-feature", context)
        assert result is True


class TestEvaluatorRegistry:
    """Tests for EvaluatorRegistry."""

    def test_built_in_evaluators(self) -> None:
        """Test built-in evaluators are registered."""
        registry = EvaluatorRegistry()

        assert registry.get("AlwaysOn") is not None
        assert registry.get("AlwaysOff") is not None
        assert registry.get("Percentage") is not None
        assert registry.get("Microsoft.Percentage") is not None
        assert registry.get("TimeWindow") is not None
        assert registry.get("Microsoft.TimeWindow") is not None
        assert registry.get("Targeting") is not None
        assert registry.get("Microsoft.Targeting") is not None
        assert registry.get("BrowserFamily") is not None
        assert registry.get("UserClaims") is not None
        assert registry.get("CountryFamily") is not None
        assert registry.get("OperatingSystem") is not None

    def test_unknown_evaluator_returns_none(self) -> None:
        """Test unknown evaluator returns None."""
        registry = EvaluatorRegistry()

        assert registry.get("Unknown") is None

    def test_register_custom_evaluator(self) -> None:
        """Test registering custom evaluator."""
        registry = EvaluatorRegistry()
        custom = AlwaysOnEvaluator()  # Using AlwaysOn as a custom one

        registry.register("Custom", custom)
        assert registry.get("Custom") == custom

    def test_evaluate_filter_with_unknown_type(self) -> None:
        """Test evaluating unknown filter type returns False."""
        registry = EvaluatorRegistry()
        filter_ = FeatureFilter(name="Unknown")
        context = EvaluationContext()

        result = registry.evaluate_filter(filter_, "test", context)
        assert result is False


class TestEvaluationEngine:
    """Tests for EvaluationEngine."""

    def test_no_filters_returns_false(self) -> None:
        """Test definition with no filters returns False."""
        engine = EvaluationEngine()
        definition = FeatureDefinition(feature_key="test")
        context = EvaluationContext()

        result = engine.evaluate(definition, context)
        assert result is False

    def test_any_requirement_with_one_passing(self) -> None:
        """Test ANY requirement with one passing filter."""
        engine = EvaluationEngine()
        definition = FeatureDefinition(
            feature_key="test",
            filters=[
                FeatureFilter(name="Percentage", parameters={"Value": 0}),
                FeatureFilter(name="AlwaysOn"),
            ],
            requirement_type="Any"
        )
        context = EvaluationContext(identity="user-123")

        result = engine.evaluate(definition, context)
        assert result is True

    def test_all_requirement_with_one_failing(self) -> None:
        """Test ALL requirement with one failing filter."""
        engine = EvaluationEngine()
        definition = FeatureDefinition(
            feature_key="test",
            filters=[
                FeatureFilter(name="Percentage", parameters={"Value": 0}),
                FeatureFilter(name="AlwaysOn"),
            ],
            requirement_type="All"
        )
        context = EvaluationContext(identity="user-123")

        result = engine.evaluate(definition, context)
        assert result is False

    def test_all_requirement_all_passing(self) -> None:
        """Test ALL requirement with all filters passing."""
        engine = EvaluationEngine()
        definition = FeatureDefinition(
            feature_key="test",
            filters=[
                FeatureFilter(name="AlwaysOn"),
                FeatureFilter(name="Percentage", parameters={"Value": 100}),
            ],
            requirement_type="All"
        )
        context = EvaluationContext(identity="user-123")

        result = engine.evaluate(definition, context)
        assert result is True

    def test_evaluate_gate_all_requirement(self) -> None:
        """Test evaluate_gate with ALL requirement."""
        engine = EvaluationEngine()
        definitions = {
            "feature1": FeatureDefinition(
                feature_key="feature1",
                filters=[FeatureFilter(name="AlwaysOn")]
            ),
            "feature2": FeatureDefinition(
                feature_key="feature2",
                filters=[FeatureFilter(name="AlwaysOn")]
            ),
        }
        context = EvaluationContext()

        result = engine.evaluate_gate(
            definitions,
            ["feature1", "feature2"],
            context,
            FeatureRequirement.ALL
        )
        assert result is True

    def test_evaluate_gate_all_with_one_disabled(self) -> None:
        """Test evaluate_gate ALL with one disabled."""
        engine = EvaluationEngine()
        definitions = {
            "feature1": FeatureDefinition(
                feature_key="feature1",
                filters=[FeatureFilter(name="AlwaysOn")]
            ),
            "feature2": FeatureDefinition(
                feature_key="feature2",
                filters=[]  # No filters = disabled
            ),
        }
        context = EvaluationContext()

        result = engine.evaluate_gate(
            definitions,
            ["feature1", "feature2"],
            context,
            FeatureRequirement.ALL
        )
        assert result is False

    def test_evaluate_gate_any_requirement(self) -> None:
        """Test evaluate_gate with ANY requirement."""
        engine = EvaluationEngine()
        definitions = {
            "feature1": FeatureDefinition(
                feature_key="feature1",
                filters=[]  # Disabled
            ),
            "feature2": FeatureDefinition(
                feature_key="feature2",
                filters=[FeatureFilter(name="AlwaysOn")]
            ),
        }
        context = EvaluationContext()

        result = engine.evaluate_gate(
            definitions,
            ["feature1", "feature2"],
            context,
            FeatureRequirement.ANY
        )
        assert result is True

    def test_evaluate_gate_any_all_disabled(self) -> None:
        """Test evaluate_gate ANY with all disabled."""
        engine = EvaluationEngine()
        definitions = {
            "feature1": FeatureDefinition(feature_key="feature1", filters=[]),
            "feature2": FeatureDefinition(feature_key="feature2", filters=[]),
        }
        context = EvaluationContext()

        result = engine.evaluate_gate(
            definitions,
            ["feature1", "feature2"],
            context,
            FeatureRequirement.ANY
        )
        assert result is False

    def test_evaluate_gate_with_negate(self) -> None:
        """Test evaluate_gate with negate."""
        engine = EvaluationEngine()
        definitions = {
            "feature1": FeatureDefinition(
                feature_key="feature1",
                filters=[FeatureFilter(name="AlwaysOn")]
            ),
        }
        context = EvaluationContext()

        result = engine.evaluate_gate(
            definitions,
            ["feature1"],
            context,
            FeatureRequirement.ALL,
            negate=True
        )
        assert result is False

    def test_evaluate_gate_empty_list(self) -> None:
        """Test evaluate_gate with empty list returns True."""
        engine = EvaluationEngine()
        context = EvaluationContext()

        result = engine.evaluate_gate({}, [], context, FeatureRequirement.ALL)
        assert result is True

    def test_evaluate_gate_missing_feature(self) -> None:
        """Test evaluate_gate with missing feature."""
        engine = EvaluationEngine()
        definitions = {}
        context = EvaluationContext()

        result = engine.evaluate_gate(
            definitions,
            ["non-existent"],
            context,
            FeatureRequirement.ALL
        )
        assert result is False
