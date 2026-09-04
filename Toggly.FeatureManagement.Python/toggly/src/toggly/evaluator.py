"""Feature flag evaluation engine."""

from __future__ import annotations

import hashlib
import secrets
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from toggly.context import EvaluationContext
from toggly.enums import FeatureRequirement
from toggly.models import FeatureDefinition, FeatureFilter

# ISO-8601 Zulu → offset form accepted by datetime.fromisoformat.
_UTC_Z_OFFSET = "+00:00"
# Anonymous percentage sampling (no sticky identity) uses a CSPRNG.
_SECURE_RANDOM = secrets.SystemRandom()


class FilterEvaluator(ABC):
    """Abstract base class for filter evaluators."""

    @abstractmethod
    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate a filter.

        Args:
            filter_: The filter to evaluate.
            feature_key: The feature key being evaluated.
            context: The evaluation context.

        Returns:
            True if the filter passes, False otherwise.

        """
        pass


def _as_float(params: dict[str, Any], *keys: str) -> float | None:
    """Read the first present float parameter; None when missing/invalid."""
    for key in keys:
        if key not in params or params[key] is None:
            continue
        value = params[key]
        if isinstance(value, bool):
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return None


def _as_string(params: dict[str, Any], key: str) -> str | None:
    value = params.get(key)
    if value is None:
        return None
    text = str(value)
    return text if text else None


def _collect_indexed_values(params: dict[str, Any], *prefixes: str) -> list[str]:
    """Collect indexed RavenDB / legacy colon-prefixed parameter values."""
    out: list[str] = []
    for key, value in params.items():
        if value is None:
            continue
        for prefix in prefixes:
            if key.startswith(prefix + ":"):
                text = str(value)
                if text:
                    out.append(text)
                break
    return out


def _contains_ignore_case(haystack: str | None, needle: str | None) -> bool:
    if haystack is None or needle is None:
        return False
    return needle.lower() in haystack.lower()


def _equals_ignore_case(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return False
    return a.lower() == b.lower()


def compute_percentile(user_id: str, feature_key: str) -> float:
    r"""Sticky bucket in [0, 100) matching Definitions / toggly-eval SHA-256.

    Hash input is ``featureKey + "\n" + userId``; little-endian uint32 from the
    first 4 digest bytes, then ``(value / 0xFFFFFFFF) * 100``.
    """
    digest = hashlib.sha256(f"{feature_key}\n{user_id}".encode()).digest()
    value = int.from_bytes(digest[:4], byteorder="little", signed=False)
    return (value / float(0xFFFFFFFF)) * 100.0


def segment_percentage_passes(
    percentage: float | None,
    feature_key: str,
    identity: str | None,
) -> bool:
    """Percentage gate for segment filters; missing or ≤0 fails closed."""
    if percentage is None or percentage <= 0:
        return False
    if percentage >= 100:
        return True
    if identity:
        return compute_percentile(identity, feature_key) < percentage
    return _SECURE_RANDOM.random() * 100 < percentage


class ParsedUserAgent:
    """Best-effort User-Agent parse result for segment filters."""

    __slots__ = ("browser_family", "os_family", "device_family")

    def __init__(self, browser_family: str, os_family: str, device_family: str) -> None:
        """Store parsed browser, OS, and device family labels."""
        self.browser_family = browser_family
        self.os_family = os_family
        self.device_family = device_family


def parse_user_agent(user_agent: str | None) -> ParsedUserAgent | None:
    """Parse a User-Agent string (best-effort parity with toggly-eval / Java)."""
    if not user_agent:
        return None
    return ParsedUserAgent(
        _detect_browser(user_agent),
        _detect_os(user_agent),
        _detect_device(user_agent),
    )


def _detect_browser(ua: str) -> str:
    if "Edg/" in ua or "EdgiOS/" in ua:
        return "Edge"
    if "OPR/" in ua or "Opera" in ua:
        return "Opera"
    if "Chrome/" in ua or "CriOS/" in ua:
        return "Chrome"
    if "Firefox/" in ua or "FxiOS/" in ua:
        return "Firefox"
    if (
        "Safari/" in ua
        and "Version/" in ua
        and "Chrome" not in ua
        and "Chromium" not in ua
    ):
        return "Safari"
    return "Other"


def _detect_os(ua: str) -> str:
    if "Android" in ua:
        return "Android"
    if (
        "iPhone" in ua
        or "iPad" in ua
        or "iPod" in ua
        or "CPU iPhone OS" in ua
        or "CPU OS" in ua
    ):
        return "iOS"
    if "Mac OS X" in ua or "Macintosh" in ua:
        return "Mac OS"
    if "Windows" in ua:
        return "Windows"
    if "Linux" in ua:
        return "Linux"
    return "Other"


def _detect_device(ua: str) -> str:
    if "iPhone" in ua:
        return "iPhone"
    if "iPad" in ua:
        return "iPad"
    if "iPod" in ua:
        return "iPod"
    return "Other"


class AlwaysOnEvaluator(FilterEvaluator):
    """Evaluator for AlwaysOn filter - always returns True."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate AlwaysOn filter."""
        return True


class AlwaysOffEvaluator(FilterEvaluator):
    """Evaluator for AlwaysOff filter - always returns False."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate AlwaysOff filter."""
        return False


class PercentageEvaluator(FilterEvaluator):
    r"""Evaluator for percentage-based rollouts.

    Uses Definitions-aligned sticky SHA-256 hashing
    (``featureKey + "\n" + identity``) for consistent buckets.
    """

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate percentage filter."""
        percentage = _as_float(filter_.parameters, "Value", "Percentage", "percentage")
        if percentage is None or percentage <= 0:
            return False
        if percentage >= 100:
            return True

        identity = context.identity
        if not identity:
            return False

        return self._calculate_bucket(identity, feature_key) < percentage

    def _calculate_bucket(self, identity: str, feature_key: str) -> float:
        """Calculate a deterministic bucket in [0, 100) for the identity."""
        return compute_percentile(identity, feature_key)


class TimeWindowEvaluator(FilterEvaluator):
    """Evaluator for time-based feature availability."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate time window filter."""
        now = datetime.now(timezone.utc)
        params = filter_.parameters

        start_str = params.get("Start") or params.get("start")
        if start_str:
            try:
                start = datetime.fromisoformat(
                    str(start_str).replace("Z", _UTC_Z_OFFSET)
                )
                if now < start:
                    return False
            except (ValueError, TypeError):
                pass

        end_str = params.get("End") or params.get("end")
        if end_str:
            try:
                end = datetime.fromisoformat(str(end_str).replace("Z", _UTC_Z_OFFSET))
                if now > end:
                    return False
            except (ValueError, TypeError):
                pass

        return True


class TargetingEvaluator(FilterEvaluator):
    """Evaluator for user/group targeting rules."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate targeting filter."""
        params = filter_.parameters

        users = self._get_users(params)
        if users and context.identity in users:
            return True

        groups = self._get_groups(params)
        if groups and context.groups and any(g in groups for g in context.groups):
            return True

        default_percentage = self._get_default_percentage(params)
        if default_percentage > 0 and context.identity:
            bucket = PercentageEvaluator()._calculate_bucket(context.identity, feature_key)
            return bucket < default_percentage

        return False

    def _get_users(self, params: dict[str, Any]) -> set[str]:
        """Extract user list from parameters."""
        users: set[str] = set()

        users_str = params.get("users") or params.get("Users")
        if users_str:
            users.update(u.strip() for u in str(users_str).split(",") if u.strip())

        for key, value in params.items():
            if key.startswith("Audience.Users:") and value:
                users.add(str(value))

        return users

    def _get_groups(self, params: dict[str, Any]) -> set[str]:
        """Extract group list from parameters."""
        groups: set[str] = set()

        groups_str = params.get("groups") or params.get("Groups")
        if groups_str:
            groups.update(g.strip() for g in str(groups_str).split(",") if g.strip())

        for key, value in params.items():
            if key.startswith("Audience.Groups:") and value:
                groups.add(str(value))

        return groups

    def _get_default_percentage(self, params: dict[str, Any]) -> float:
        percentage = _as_float(
            params,
            "Audience.DefaultRolloutPercentage",
            "DefaultRolloutPercentage",
            "defaultRolloutPercentage",
            "default_percentage",
            "Percentage",
        )
        return percentage if percentage is not None else 0.0


class BrowserFamilyEvaluator(FilterEvaluator):
    """Evaluator for BrowserFamily segment filters."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate BrowserFamily filter."""
        percentage = _as_float(filter_.parameters, "Percentage")
        identity = context.identity if context else None
        if not segment_percentage_passes(percentage, feature_key, identity):
            return False
        values = _collect_indexed_values(filter_.parameters, "BrowserFamily")
        if not values:
            return False
        ua = context.request.user_agent if context and context.request else None
        parsed = parse_user_agent(ua)
        if parsed is None or parsed.browser_family == "Other":
            return False
        return any(_contains_ignore_case(parsed.browser_family, value) for value in values)


class BrowserLanguageEvaluator(FilterEvaluator):
    """Evaluator for BrowserLanguage segment filters."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate BrowserLanguage filter."""
        percentage = _as_float(filter_.parameters, "Percentage")
        identity = context.identity if context else None
        if not segment_percentage_passes(percentage, feature_key, identity):
            return False
        values = _collect_indexed_values(filter_.parameters, "BrowserLanguage")
        if not values:
            return False
        accept = context.request.accept_language if context and context.request else None
        if not accept:
            return False
        return any(_contains_ignore_case(accept, value) for value in values)


class CountryEvaluator(FilterEvaluator):
    """Evaluator for Country / CountryFamily segment filters."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate Country filter."""
        percentage = _as_float(filter_.parameters, "Percentage")
        identity = context.identity if context else None
        if not segment_percentage_passes(percentage, feature_key, identity):
            return False
        values = _collect_indexed_values(filter_.parameters, "Country")
        if not values:
            return False
        country = context.request.country if context and context.request else None
        if not country:
            return False
        return any(_equals_ignore_case(value, country) for value in values)


class DeviceTypeEvaluator(FilterEvaluator):
    """Evaluator for DeviceType segment filters."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate DeviceType filter."""
        percentage = _as_float(filter_.parameters, "Percentage")
        identity = context.identity if context else None
        if not segment_percentage_passes(percentage, feature_key, identity):
            return False
        values = _collect_indexed_values(filter_.parameters, "DeviceType")
        if not values:
            return False
        ua = context.request.user_agent if context and context.request else None
        parsed = parse_user_agent(ua)
        if parsed is None or parsed.device_family == "Other":
            return False
        return any(_contains_ignore_case(parsed.device_family, value) for value in values)


class OperatingSystemEvaluator(FilterEvaluator):
    """Evaluator for OS / OperatingSystem segment filters."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate OperatingSystem filter."""
        percentage = _as_float(filter_.parameters, "Percentage")
        identity = context.identity if context else None
        if not segment_percentage_passes(percentage, feature_key, identity):
            return False
        values = _collect_indexed_values(filter_.parameters, "OperatingSystem")
        if not values:
            return False
        ua = context.request.user_agent if context and context.request else None
        parsed = parse_user_agent(ua)
        if parsed is None or parsed.os_family == "Other":
            return False
        return any(_contains_ignore_case(parsed.os_family, value) for value in values)


class UserClaimsEvaluator(FilterEvaluator):
    """Evaluator for UserClaims filters (Claim + Value params)."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate UserClaims filter."""
        percentage = _as_float(filter_.parameters, "Percentage")
        identity = context.identity if context else None
        if not segment_percentage_passes(percentage, feature_key, identity):
            return False
        claim_type = _as_string(filter_.parameters, "Claim")
        claim_value = _as_string(filter_.parameters, "Value")
        if claim_type is None or claim_value is None or context is None:
            return False
        claims = context.claims
        if not claims or claim_type not in claims:
            return False
        return claim_value == claims[claim_type]


FILTER_CONTEXT_PROPERTY = "ContextProperty"


def _param(params: dict[str, Any], key: str) -> Any:
    if key in params:
        return params[key]
    lower = key.lower()
    for name, value in params.items():
        if name.lower() == lower:
            return value
    return None


class ContextPropertyEvaluator(FilterEvaluator):
    """Evaluator for ContextProperty entity filters. Fail closed."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate a ContextProperty filter against the current entity."""
        if context.entity is None:
            return False
        return self.evaluate_single(filter_, context.entity)

    @staticmethod
    def is_context_property_filter(filter_: FeatureFilter) -> bool:
        """Return whether the filter is a ContextProperty filter."""
        return filter_.name.lower() == FILTER_CONTEXT_PROPERTY.lower()

    @classmethod
    def entity_filters(cls, definition: FeatureDefinition) -> list[FeatureFilter]:
        """Return ContextProperty filters from a definition."""
        return [f for f in definition.filters if cls.is_context_property_filter(f)]

    @classmethod
    def user_filters(cls, definition: FeatureDefinition) -> list[FeatureFilter]:
        """Return non-ContextProperty filters from a definition."""
        return [f for f in definition.filters if not cls.is_context_property_filter(f)]

    @classmethod
    def evaluate_entity_filters(
        cls, definition: FeatureDefinition, entity: Any
    ) -> bool:
        """Evaluate entity filters against an entity, failing closed."""
        filters = cls.entity_filters(definition)
        if not filters or entity is None:
            return False
        req = (definition.context_requirement_type or definition.requirement_type or "Any").lower()
        results = [cls.evaluate_single(f, entity) for f in filters]
        if req == "all":
            return all(results)
        return any(results)

    @classmethod
    def evaluate_single(cls, filter_: FeatureFilter, entity: Any) -> bool:
        """Evaluate one ContextProperty filter against an entity."""
        params = filter_.parameters
        property_name = _param(params, "Property")
        op = _param(params, "Operator")
        expected = _param(params, "Value")
        value_type = _param(params, "ValueType") or "string"
        if not property_name or not op or expected is None:
            return False
        op = str(op).lower()
        value_type = str(value_type).lower()
        expected_s = str(expected)
        contains = getattr(entity, "contains_attribute", None)
        get_attr = getattr(entity, "get_attribute", None)
        attrs = getattr(entity, "attributes", None)
        if callable(contains):
            if not contains(str(property_name)):
                return False
            actual = get_attr(str(property_name)) if callable(get_attr) else None
        elif isinstance(attrs, dict):
            actual = None
            found = False
            if str(property_name) in attrs:
                actual = attrs[str(property_name)]
                found = True
            else:
                lower = str(property_name).lower()
                for k, v in attrs.items():
                    if str(k).lower() == lower:
                        actual = v
                        found = True
                        break
            if not found:
                return False
        else:
            return False
        return cls._compare(actual, op, expected_s, value_type)

    @staticmethod
    def _compare(actual: Any, op: str, expected: str, value_type: str) -> bool:
        if op in ("eq", "neq"):
            actual_s = "" if actual is None else str(actual)
            equal = actual_s.lower() == expected.lower()
            return equal if op == "eq" else not equal
        if op in ("gt", "gte", "lt", "lte"):
            return ContextPropertyEvaluator._compare_ordered(actual, expected, value_type, op)
        if op == "in":
            actual_s = "" if actual is None else str(actual)
            return any(
                c.strip().lower() == actual_s.lower()
                for c in expected.split(",")
                if c.strip()
            )
        if op == "contains":
            if value_type == "string[]":
                values = actual if isinstance(actual, (list, tuple, set)) else []
                return any(str(v).lower() == expected.lower() for v in values)
            actual_s = "" if actual is None else str(actual)
            return expected.lower() in actual_s.lower()
        return False

    @staticmethod
    def _compare_ordered(actual: Any, expected: str, value_type: str, op: str) -> bool:
        if value_type == "datetime":
            actual_dt = ContextPropertyEvaluator._parse_dt(actual)
            expected_dt = ContextPropertyEvaluator._parse_dt(expected)
            if actual_dt is None or expected_dt is None:
                return False
            if op == "gt":
                return actual_dt > expected_dt
            if op == "gte":
                return actual_dt >= expected_dt
            if op == "lt":
                return actual_dt < expected_dt
            if op == "lte":
                return actual_dt <= expected_dt
            return False
        if value_type == "number":
            try:
                actual_n = float(actual)
                expected_n = float(expected)
            except (TypeError, ValueError):
                return False
            if op == "gt":
                return actual_n > expected_n
            if op == "gte":
                return actual_n >= expected_n
            if op == "lt":
                return actual_n < expected_n
            if op == "lte":
                return actual_n <= expected_n
            return False
        return False

    @staticmethod
    def _parse_dt(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value
        text = str(value)
        try:
            parsed = datetime.fromisoformat(text.replace("Z", _UTC_Z_OFFSET))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except (ValueError, TypeError):
            return None


class EvaluatorRegistry:
    """Registry of filter evaluators."""

    def __init__(self) -> None:
        """Initialize the evaluator registry with built-in evaluators."""
        always_on = AlwaysOnEvaluator()
        always_off = AlwaysOffEvaluator()
        percentage = PercentageEvaluator()
        time_window = TimeWindowEvaluator()
        targeting = TargetingEvaluator()
        context_property = ContextPropertyEvaluator()
        browser_family = BrowserFamilyEvaluator()
        browser_language = BrowserLanguageEvaluator()
        country = CountryEvaluator()
        device_type = DeviceTypeEvaluator()
        operating_system = OperatingSystemEvaluator()
        user_claims = UserClaimsEvaluator()

        self._evaluators: dict[str, FilterEvaluator] = {
            "AlwaysOn": always_on,
            "AlwaysOff": always_off,
            "Percentage": percentage,
            "Microsoft.Percentage": percentage,
            "TimeWindow": time_window,
            "Microsoft.TimeWindow": time_window,
            "Targeting": targeting,
            "Microsoft.Targeting": targeting,
            "ContextProperty": context_property,
            "BrowserFamily": browser_family,
            "BrowserLanguage": browser_language,
            "Country": country,
            "CountryFamily": country,
            "DeviceType": device_type,
            "OS": operating_system,
            "OperatingSystem": operating_system,
            "UserClaims": user_claims,
        }

    def register(self, name: str, evaluator: FilterEvaluator) -> None:
        """Register a custom evaluator."""
        self._evaluators[name] = evaluator

    def get(self, name: str) -> FilterEvaluator | None:
        """Get an evaluator by name."""
        return self._evaluators.get(name)

    def evaluate_filter(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate a filter using the appropriate evaluator.

        Unknown filter types fail closed (False).
        """
        evaluator = self.get(filter_.name)
        if evaluator is None:
            return False
        return evaluator.evaluate(filter_, feature_key, context)


class EvaluationEngine:
    """Engine for evaluating feature flags."""

    def __init__(self, registry: EvaluatorRegistry | None = None) -> None:
        """Initialize the evaluation engine."""
        self._registry = registry or EvaluatorRegistry()

    @property
    def registry(self) -> EvaluatorRegistry:
        """Get the evaluator registry."""
        return self._registry

    def evaluate(
        self,
        definition: FeatureDefinition,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate a feature definition."""
        if not definition.filters:
            return False

        entity_filters = ContextPropertyEvaluator.entity_filters(definition)
        user_filters = ContextPropertyEvaluator.user_filters(definition)

        if entity_filters:
            if context is None or context.entity is None:
                return False
            if not ContextPropertyEvaluator.evaluate_entity_filters(definition, context.entity):
                return False
            if not user_filters:
                return True
            return self._evaluate_group(
                user_filters,
                definition.requirement_type,
                definition.feature_key,
                context,
            )

        return self._evaluate_group(
            user_filters,
            definition.requirement_type,
            definition.feature_key,
            context,
        )

    def _evaluate_group(
        self,
        filters: list[FeatureFilter],
        requirement_type: str,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        if not filters:
            return False
        requirement = (requirement_type or "any").lower()
        if requirement == "all":
            return all(
                self._registry.evaluate_filter(f, feature_key, context) for f in filters
            )
        return any(self._registry.evaluate_filter(f, feature_key, context) for f in filters)

    def evaluate_gate(
        self,
        definitions: dict[str, FeatureDefinition],
        feature_keys: list[str],
        context: EvaluationContext,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        negate: bool = False,
    ) -> bool:
        """Evaluate multiple features as a gate."""
        if not feature_keys:
            result = True
        elif requirement == FeatureRequirement.ALL:
            result = all(
                self._evaluate_feature(definitions.get(key), context)
                for key in feature_keys
            )
        else:
            result = any(
                self._evaluate_feature(definitions.get(key), context)
                for key in feature_keys
            )

        return not result if negate else result

    def _evaluate_feature(
        self,
        definition: FeatureDefinition | None,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate a single feature."""
        if definition is None:
            return False
        return self.evaluate(definition, context)
