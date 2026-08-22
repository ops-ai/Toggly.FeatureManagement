"""Evaluation context for feature flag evaluation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TogglyEntityContext:
    """Canonical entity instance for ContextProperty evaluation."""

    kind: str
    key: str
    attributes: dict[str, Any] = field(default_factory=dict)

    def get_attribute(self, name: str) -> Any:
        if name in self.attributes:
            return self.attributes[name]
        lower = name.lower()
        for key, value in self.attributes.items():
            if key.lower() == lower:
                return value
        return None

    def contains_attribute(self, name: str) -> bool:
        if name in self.attributes:
            return True
        lower = name.lower()
        return any(key.lower() == lower for key in self.attributes)


@dataclass
class EvaluationContext:
    """Context for evaluating feature flags.

    The evaluation context provides information about the current user,
    their groups, and any additional attributes that can be used for
    targeting and percentage rollouts.

    Example:
        >>> context = EvaluationContext(
        ...     identity="user-123",
        ...     groups=["beta-testers", "premium"],
        ...     traits={"country": "US", "plan": "enterprise"}
        ... )

    """

    identity: str | None = None
    """Unique identifier for the user/device. Used for deterministic rollouts."""

    groups: list[str] = field(default_factory=list)
    """Groups the user belongs to (e.g., 'beta-testers', 'admins')."""

    traits: dict[str, Any] = field(default_factory=dict)
    """Additional attributes for targeting (e.g., country, plan, version)."""

    entity: TogglyEntityContext | None = None
    """Optional entity for ContextProperty filters."""

    def with_identity(self, identity: str) -> EvaluationContext:
        """Create a new context with the specified identity.

        Args:
            identity: The user identity to set.

        Returns:
            A new EvaluationContext with the updated identity.

        """
        return EvaluationContext(
            identity=identity,
            groups=self.groups.copy(),
            traits=self.traits.copy(),
            entity=self.entity,
        )

    def with_groups(self, *groups: str) -> EvaluationContext:
        """Create a new context with additional groups.

        Args:
            *groups: Groups to add to the context.

        Returns:
            A new EvaluationContext with the updated groups.

        """
        return EvaluationContext(
            identity=self.identity,
            groups=list(set(self.groups + list(groups))),
            traits=self.traits.copy(),
            entity=self.entity,
        )

    def with_traits(self, **traits: Any) -> EvaluationContext:
        """Create a new context with additional traits.

        Args:
            **traits: Traits to add to the context.

        Returns:
            A new EvaluationContext with the updated traits.

        """
        merged_traits = {**self.traits, **traits}
        return EvaluationContext(
            identity=self.identity,
            groups=self.groups.copy(),
            traits=merged_traits,
            entity=self.entity,
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert context to a dictionary.

        Returns:
            Dictionary representation of the context.

        """
        return {
            "identity": self.identity,
            "groups": self.groups,
            "traits": self.traits,
            "entity": None
            if self.entity is None
            else {"kind": self.entity.kind, "key": self.entity.key, "attributes": self.entity.attributes},
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvaluationContext:
        """Create a context from a dictionary.

        Args:
            data: Dictionary with context data.

        Returns:
            An EvaluationContext instance.

        """
        entity_data = data.get("entity")
        entity = None
        if isinstance(entity_data, dict):
            entity = TogglyEntityContext(
                kind=str(entity_data.get("kind", "")),
                key=str(entity_data.get("key", "")),
                attributes=entity_data.get("attributes") or {},
            )
        return cls(
            identity=data.get("identity"),
            groups=data.get("groups", []),
            traits=data.get("traits", {}),
            entity=entity,
        )

    @classmethod
    def anonymous(cls) -> EvaluationContext:
        """Create an anonymous evaluation context.

        Returns:
            An EvaluationContext with no identity.

        """
        return cls()

    def __bool__(self) -> bool:
        """Check if context has any meaningful data.

        Returns:
            True if context has identity, groups, or traits.

        """
        return bool(self.identity or self.groups or self.traits or self.entity)
