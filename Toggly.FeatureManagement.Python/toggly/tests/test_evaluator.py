"""Tests for feature flag evaluation."""

from datetime import datetime, timedelta, timezone

from toggly import (
    EvaluationContext,
    FeatureDefinition,
    FeatureFilter,
    FeatureRequirement,
)
from toggly.context import RequestContext
from toggly.evaluator import (
    AlwaysOffEvaluator,
    AlwaysOnEvaluator,
    BrowserFamilyEvaluator,
    BrowserLanguageEvaluator,
    CountryEvaluator,
    DeviceTypeEvaluator,
    EvaluationEngine,
    EvaluatorRegistry,
    OperatingSystemEvaluator,
    PercentageEvaluator,
    TargetingEvaluator,
    TimeWindowEvaluator,
    UserClaimsEvaluator,
    compute_percentile,
    parse_user_agent,
    segment_percentage_passes,
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


class TestAlwaysOffEvaluator:
    """Tests for AlwaysOff filter evaluator."""

    def test_always_returns_false(self) -> None:
        """Test AlwaysOff always returns False."""
        evaluator = AlwaysOffEvaluator()
        filter_ = FeatureFilter(name="AlwaysOff")
        assert evaluator.evaluate(filter_, "test-feature", EvaluationContext()) is False


class TestSegmentPercentageAndUa:
    """Sticky buckets, anonymous sampling, and UA parsing helpers."""

    def test_segment_percentage_edges(self) -> None:
        """Test fail-closed and always-on percentage gates."""
        assert segment_percentage_passes(None, "f", "u") is False
        assert segment_percentage_passes(0, "f", "u") is False
        assert segment_percentage_passes(100, "f", None) is True
        assert segment_percentage_passes(50, "f", "user-a") is (
            compute_percentile("user-a", "f") < 50
        )

    def test_anonymous_percentage_uses_secure_sampler(self) -> None:
        """Anonymous sampling is boolean; 0 fails, 100 passes without identity."""
        assert segment_percentage_passes(0.0, "f", None) is False
        assert segment_percentage_passes(100.0, "f", None) is True
        # Mid-range without identity is non-deterministic; just ensure no crash.
        result = segment_percentage_passes(50.0, "f", None)
        assert result in (True, False)

    def test_parse_user_agent_families(self) -> None:
        """Test browser/OS/device detection branches."""
        assert parse_user_agent(None) is None
        assert parse_user_agent("") is None

        edge = parse_user_agent(
            "Mozilla/5.0 Edg/120.0 Chrome/120.0 Safari/537.36"
        )
        assert edge is not None
        assert edge.browser_family == "Edge"

        opera = parse_user_agent("Mozilla/5.0 OPR/90.0")
        assert opera is not None
        assert opera.browser_family == "Opera"

        chrome = parse_user_agent("Mozilla/5.0 Chrome/120.0 Safari/537.36")
        assert chrome is not None
        assert chrome.browser_family == "Chrome"

        firefox = parse_user_agent("Mozilla/5.0 Firefox/121.0")
        assert firefox is not None
        assert firefox.browser_family == "Firefox"

        safari = parse_user_agent(
            "Mozilla/5.0 Version/17.0 Safari/605.1.15 Macintosh"
        )
        assert safari is not None
        assert safari.browser_family == "Safari"
        assert safari.os_family == "Mac OS"

        android = parse_user_agent("Mozilla/5.0 Android 14 Chrome/120.0")
        assert android is not None
        assert android.os_family == "Android"

        ios = parse_user_agent("Mozilla/5.0 iPhone OS 17_0 like Mac OS X")
        assert ios is not None
        assert ios.os_family == "iOS"
        assert ios.device_family == "iPhone"

        ipad = parse_user_agent("Mozilla/5.0 iPad; CPU OS 17_0")
        assert ipad is not None
        assert ipad.device_family == "iPad"

        windows = parse_user_agent("Mozilla/5.0 Windows NT 10.0 Firefox/121.0")
        assert windows is not None
        assert windows.os_family == "Windows"

        linux = parse_user_agent("Mozilla/5.0 Linux x86_64 Firefox/121.0")
        assert linux is not None
        assert linux.os_family == "Linux"

        other = parse_user_agent("curl/8.0")
        assert other is not None
        assert other.browser_family == "Other"
        assert other.os_family == "Other"
        assert other.device_family == "Other"


class TestSegmentFilterEvaluators:
    """Segment filter evaluators registered for filter parity."""

    def test_browser_family_match(self) -> None:
        """BrowserFamily matches parsed Chrome with sticky percentage."""
        evaluator = BrowserFamilyEvaluator()
        filter_ = FeatureFilter(
            name="BrowserFamily",
            parameters={
                "Percentage": 100,
                "BrowserFamily:0": "Chrome",
            },
        )
        context = EvaluationContext(
            identity="user-1",
            request=RequestContext(
                user_agent="Mozilla/5.0 Chrome/120.0 Safari/537.36"
            ),
        )
        assert evaluator.evaluate(filter_, "feat", context) is True

    def test_browser_family_fail_closed_paths(self) -> None:
        """Missing values / Other UA fail closed."""
        evaluator = BrowserFamilyEvaluator()
        assert (
            evaluator.evaluate(
                FeatureFilter(name="BrowserFamily", parameters={"Percentage": 100}),
                "feat",
                EvaluationContext(identity="u"),
            )
            is False
        )
        assert (
            evaluator.evaluate(
                FeatureFilter(
                    name="BrowserFamily",
                    parameters={"Percentage": 100, "BrowserFamily:0": "Chrome"},
                ),
                "feat",
                EvaluationContext(identity="u", request=RequestContext(user_agent="curl")),
            )
            is False
        )

    def test_browser_language_country_device_os(self) -> None:
        """Language, country, device, and OS segment matchers."""
        lang = BrowserLanguageEvaluator()
        assert (
            lang.evaluate(
                FeatureFilter(
                    name="BrowserLanguage",
                    parameters={"Percentage": 100, "BrowserLanguage:0": "en"},
                ),
                "feat",
                EvaluationContext(
                    identity="u",
                    request=RequestContext(accept_language="en-US,en;q=0.9"),
                ),
            )
            is True
        )
        assert (
            lang.evaluate(
                FeatureFilter(
                    name="BrowserLanguage",
                    parameters={"Percentage": 100, "BrowserLanguage:0": "fr"},
                ),
                "feat",
                EvaluationContext(identity="u", request=RequestContext()),
            )
            is False
        )

        country = CountryEvaluator()
        assert (
            country.evaluate(
                FeatureFilter(
                    name="Country",
                    parameters={"Percentage": 100, "Country:0": "us"},
                ),
                "feat",
                EvaluationContext(
                    identity="u", request=RequestContext(country="US")
                ),
            )
            is True
        )
        assert (
            country.evaluate(
                FeatureFilter(
                    name="Country",
                    parameters={"Percentage": 100, "Country:0": "US"},
                ),
                "feat",
                EvaluationContext(identity="u"),
            )
            is False
        )

        device = DeviceTypeEvaluator()
        assert (
            device.evaluate(
                FeatureFilter(
                    name="DeviceType",
                    parameters={"Percentage": 100, "DeviceType:0": "iPhone"},
                ),
                "feat",
                EvaluationContext(
                    identity="u",
                    request=RequestContext(user_agent="Mozilla/5.0 iPhone"),
                ),
            )
            is True
        )

        os_eval = OperatingSystemEvaluator()
        assert (
            os_eval.evaluate(
                FeatureFilter(
                    name="OperatingSystem",
                    parameters={"Percentage": 100, "OperatingSystem:0": "Android"},
                ),
                "feat",
                EvaluationContext(
                    identity="u",
                    request=RequestContext(user_agent="Mozilla/5.0 Android Chrome/1"),
                ),
            )
            is True
        )

    def test_user_claims_match_and_fail_closed(self) -> None:
        """UserClaims matches claim value; missing claim fails closed."""
        evaluator = UserClaimsEvaluator()
        filter_ = FeatureFilter(
            name="UserClaims",
            parameters={"Percentage": 100, "Claim": "role", "Value": "admin"},
        )
        assert (
            evaluator.evaluate(
                filter_,
                "feat",
                EvaluationContext(identity="u", claims={"role": "admin"}),
            )
            is True
        )
        assert (
            evaluator.evaluate(
                filter_,
                "feat",
                EvaluationContext(identity="u", claims={"role": "user"}),
            )
            is False
        )
        assert (
            evaluator.evaluate(
                FeatureFilter(
                    name="UserClaims",
                    parameters={"Percentage": 100, "Claim": "role"},
                ),
                "feat",
                EvaluationContext(identity="u", claims={"role": "admin"}),
            )
            is False
        )


class TestTimeWindowZuluSuffix:
    """TimeWindow accepts trailing Z via shared UTC offset constant."""

    def test_zulu_start_in_past_passes(self) -> None:
        """Past Start with Z suffix is inside the window."""
        evaluator = TimeWindowEvaluator()
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        filter_ = FeatureFilter(name="TimeWindow", parameters={"Start": past})
        assert evaluator.evaluate(filter_, "feat", EvaluationContext()) is True
