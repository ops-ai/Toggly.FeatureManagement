"""Feature flag evaluation engine."""

from __future__ import annotations

import hashlib
import struct
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from toggly.context import EvaluationContext
from toggly.enums import FeatureRequirement
from toggly.models import FeatureDefinition, FeatureFilter


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


class AlwaysOnEvaluator(FilterEvaluator):
    """Evaluator for AlwaysOn filter - always returns True."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate AlwaysOn filter.

        Args:
            filter_: The filter to evaluate.
            feature_key: The feature key being evaluated.
            context: The evaluation context.

        Returns:
            Always True.
        """
        return True


class PercentageEvaluator(FilterEvaluator):
    """Evaluator for percentage-based rollouts.

    Uses deterministic hashing based on identity + feature key to ensure
    consistent results for the same user.
    """

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate percentage filter.

        Args:
            filter_: The filter to evaluate.
            feature_key: The feature key being evaluated.
            context: The evaluation context.

        Returns:
            True if the user falls within the rollout percentage.
        """
        # Get percentage from parameters (support both 'Value' and 'Percentage')
        percentage = filter_.parameters.get("Value") or filter_.parameters.get(
            "Percentage", filter_.parameters.get("percentage", 0)
        )

        try:
            percentage = float(percentage)
        except (TypeError, ValueError):
            return False

        if percentage <= 0:
            return False
        if percentage >= 100:
            return True

        # Need identity for percentage rollout
        identity = context.identity
        if not identity:
            return False

        # Calculate deterministic bucket
        bucket = self._calculate_bucket(identity, feature_key)
        return bucket < percentage

    def _calculate_bucket(self, identity: str, feature_key: str) -> float:
        """Calculate a deterministic bucket (0-100) for the identity.

        Uses FNV-1a hash for consistency with other SDKs.

        Args:
            identity: User identity.
            feature_key: Feature key.

        Returns:
            A bucket value between 0 and 99.99.
        """
        # Combine identity and feature key
        hash_input = f"{identity}:{feature_key}"

        # Use FNV-1a 32-bit hash for consistency with Go SDK
        hash_value = self._fnv1a_32(hash_input.encode("utf-8"))

        # Convert to percentage (0-99.99)
        return (hash_value % 10000) / 100.0

    @staticmethod
    def _fnv1a_32(data: bytes) -> int:
        """Calculate FNV-1a 32-bit hash.

        Args:
            data: Data to hash.

        Returns:
            32-bit hash value.
        """
        FNV_32_PRIME = 0x01000193
        FNV1_32A_INIT = 0x811C9DC5

        hash_value = FNV1_32A_INIT
        for byte in data:
            hash_value ^= byte
            hash_value = (hash_value * FNV_32_PRIME) & 0xFFFFFFFF

        return hash_value


class TimeWindowEvaluator(FilterEvaluator):
    """Evaluator for time-based feature availability."""

    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate time window filter.

        Args:
            filter_: The filter to evaluate.
            feature_key: The feature key being evaluated.
            context: The evaluation context.

        Returns:
            True if current time is within the window.
        """
        now = datetime.now(timezone.utc)
        params = filter_.parameters

        # Check start time
        start_str = params.get("Start") or params.get("start")
        if start_str:
            try:
                start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                if now < start:
                    return False
            except (ValueError, TypeError):
                pass

        # Check end time
        end_str = params.get("End") or params.get("end")
        if end_str:
            try:
                end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
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
        """Evaluate targeting filter.

        Args:
            filter_: The filter to evaluate.
            feature_key: The feature key being evaluated.
            context: The evaluation context.

        Returns:
            True if the user/group matches targeting rules.
        """
        params = filter_.parameters

        # Check specific users
        users = self._get_users(params)
        if users and context.identity in users:
            return True

        # Check groups
        groups = self._get_groups(params)
        if groups and context.groups:
            if any(g in groups for g in context.groups):
                return True

        # Check default rollout percentage
        default_percentage = params.get("DefaultRolloutPercentage") or params.get(
            "defaultRolloutPercentage", params.get("default_percentage", 0)
        )
        try:
            default_percentage = float(default_percentage)
        except (TypeError, ValueError):
            default_percentage = 0

        if default_percentage > 0 and context.identity:
            bucket = PercentageEvaluator()._calculate_bucket(context.identity, feature_key)
            return bucket < default_percentage

        return False

    def _get_users(self, params: dict[str, Any]) -> set[str]:
        """Extract user list from parameters.

        Args:
            params: Filter parameters.

        Returns:
            Set of user identities.
        """
        users: set[str] = set()

        # Try 'users' parameter (comma-separated)
        users_str = params.get("users") or params.get("Users")
        if users_str:
            users.update(u.strip() for u in str(users_str).split(",") if u.strip())

        # Try indexed 'Audience.Users:N' format (Go SDK pattern)
        for key, value in params.items():
            if key.startswith("Audience.Users:"):
                if value:
                    users.add(str(value))

        return users

    def _get_groups(self, params: dict[str, Any]) -> set[str]:
        """Extract group list from parameters.

        Args:
            params: Filter parameters.

        Returns:
            Set of group names.
        """
        groups: set[str] = set()

        # Try 'groups' parameter (comma-separated)
        groups_str = params.get("groups") or params.get("Groups")
        if groups_str:
            groups.update(g.strip() for g in str(groups_str).split(",") if g.strip())

        # Try indexed 'Audience.Groups:N' format (Go SDK pattern)
        for key, value in params.items():
            if key.startswith("Audience.Groups:"):
                if value:
                    groups.add(str(value))

        return groups


class EvaluatorRegistry:
    """Registry of filter evaluators."""

    def __init__(self) -> None:
        """Initialize the evaluator registry with built-in evaluators."""
        self._evaluators: dict[str, FilterEvaluator] = {
            "AlwaysOn": AlwaysOnEvaluator(),
            "Percentage": PercentageEvaluator(),
            "TimeWindow": TimeWindowEvaluator(),
            "Targeting": TargetingEvaluator(),
        }

    def register(self, name: str, evaluator: FilterEvaluator) -> None:
        """Register a custom evaluator.

        Args:
            name: Name of the filter type.
            evaluator: The evaluator instance.
        """
        self._evaluators[name] = evaluator

    def get(self, name: str) -> FilterEvaluator | None:
        """Get an evaluator by name.

        Args:
            name: Name of the filter type.

        Returns:
            The evaluator or None if not found.
        """
        return self._evaluators.get(name)

    def evaluate_filter(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        """Evaluate a filter using the appropriate evaluator.

        Args:
            filter_: The filter to evaluate.
            feature_key: The feature key being evaluated.
            context: The evaluation context.

        Returns:
            True if the filter passes, False otherwise.
        """
        evaluator = self.get(filter_.name)
        if evaluator is None:
            # Unknown filter type - treat as False for safety
            return False
        return evaluator.evaluate(filter_, feature_key, context)


class EvaluationEngine:
    """Engine for evaluating feature flags."""

    def __init__(self, registry: EvaluatorRegistry | None = None) -> None:
        """Initialize the evaluation engine.

        Args:
            registry: Custom evaluator registry. Uses default if not provided.
        """
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
        """Evaluate a feature definition.

        Args:
            definition: The feature definition to evaluate.
            context: The evaluation context.

        Returns:
            True if the feature should be enabled.
        """
        if not definition.filters:
            # No filters means feature is disabled
            return False

        requirement = definition.requirement_type.lower()

        if requirement == "all":
            # All filters must pass
            return all(
                self._registry.evaluate_filter(f, definition.feature_key, context)
                for f in definition.filters
            )
        else:
            # Any filter must pass (default)
            return any(
                self._registry.evaluate_filter(f, definition.feature_key, context)
                for f in definition.filters
            )

    def evaluate_gate(
        self,
        definitions: dict[str, FeatureDefinition],
        feature_keys: list[str],
        context: EvaluationContext,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        negate: bool = False,
    ) -> bool:
        """Evaluate multiple features as a gate.

        Args:
            definitions: Dictionary of feature definitions.
            feature_keys: List of feature keys to evaluate.
            context: The evaluation context.
            requirement: Whether ALL or ANY features must be enabled.
            negate: Whether to negate the final result.

        Returns:
            True if the gate passes.
        """
        if not feature_keys:
            # Empty list returns True (no requirements to fail)
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
        """Evaluate a single feature.

        Args:
            definition: The feature definition (may be None).
            context: The evaluation context.

        Returns:
            True if the feature is enabled.
        """
        if definition is None:
            return False
        return self.evaluate(definition, context)
