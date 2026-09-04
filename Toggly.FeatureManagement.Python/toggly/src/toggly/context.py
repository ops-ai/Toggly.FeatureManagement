"""Evaluation context for feature flag evaluation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass
class TogglyEntityContext:
    """Canonical entity instance for ContextProperty evaluation."""

    kind: str
    key: str
    attributes: dict[str, Any] = field(default_factory=dict)

    def get_attribute(self, name: str) -> Any:
        """Return an attribute by name, matching case-insensitively."""
        if name in self.attributes:
            return self.attributes[name]
        lower = name.lower()
        for key, value in self.attributes.items():
            if key.lower() == lower:
                return value
        return None

    def contains_attribute(self, name: str) -> bool:
        """Return whether an attribute exists, matching case-insensitively."""
        if name in self.attributes:
            return True
        lower = name.lower()
        return any(key.lower() == lower for key in self.attributes)


@dataclass
class RequestContext:
    """HTTP request fields used by segment identity filters."""

    user_agent: str | None = None
    """User-Agent header value."""

    accept_language: str | None = None
    """Accept-Language header value."""

    country: str | None = None
    """Country code (e.g. from CF-IPCountry)."""

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary (camelCase keys for EvalContext parity)."""
        return {
            "userAgent": self.user_agent,
            "acceptLanguage": self.accept_language,
            "country": self.country,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> RequestContext | None:
        """Create from a dictionary accepting camelCase or snake_case keys."""
        if not data:
            return None
        return cls(
            user_agent=_first_str(data, "userAgent", "user_agent"),
            accept_language=_first_str(data, "acceptLanguage", "accept_language"),
            country=_first_str(data, "country"),
        )


def _first_str(data: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        if key in data and data[key] is not None:
            value = str(data[key])
            return value if value else None
    return None


class HttpRequestMapper:
    """Maps common HTTP headers into RequestContext fields.

    Does not invent identity, groups, or claims — merge those separately.
    """

    @staticmethod
    def from_http_headers(headers: Mapping[str, str] | None) -> RequestContext:
        """Build RequestContext from a header bag (case-insensitive keys)."""
        if not headers:
            return RequestContext()
        return RequestContext(
            user_agent=_header(headers, "user-agent"),
            accept_language=_header(headers, "accept-language"),
            country=_first_present(
                headers,
                "cf-ipcountry",
                "x-vercel-ip-country",
                "cloudfront-viewer-country",
            ),
        )

    @staticmethod
    def merge_into(
        headers: Mapping[str, str] | None,
        base: EvaluationContext | None,
    ) -> EvaluationContext:
        """Merge HTTP-mapped request fields over an existing evaluation context."""
        request = HttpRequestMapper.from_http_headers(headers)
        if base is None:
            return EvaluationContext(request=request)
        return base.with_request(request)


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lower = name.lower()
    for key, value in headers.items():
        if key is not None and key.lower() == lower and value:
            return value
    return None


def _first_present(headers: Mapping[str, str], *names: str) -> str | None:
    for name in names:
        value = _header(headers, name)
        if value is not None:
            return value
    return None


@dataclass
class EvaluationContext:
    """Context for evaluating feature flags.

    The evaluation context provides information about the current user,
    their groups, claims, request fields, and any additional attributes
    used for targeting and percentage rollouts.

    Example:
        >>> context = EvaluationContext(
        ...     identity="user-123",
        ...     groups=["beta-testers", "premium"],
        ...     claims={"role": "admin"},
        ...     request=RequestContext(country="US"),
        ...     traits={"plan": "enterprise"}
        ... )

    """

    identity: str | None = None
    """Unique identifier for the user/device. Used for deterministic rollouts."""

    groups: list[str] = field(default_factory=list)
    """Groups the user belongs to (e.g., 'beta-testers', 'admins')."""

    traits: dict[str, Any] = field(default_factory=dict)
    """Additional attributes for targeting (e.g., country, plan, version)."""

    claims: dict[str, str] = field(default_factory=dict)
    """Principal / JWT-style claims for UserClaims filters."""

    request: RequestContext | None = None
    """HTTP request fields for segment filters."""

    entity: TogglyEntityContext | None = None
    """Optional entity for ContextProperty filters."""

    def with_identity(self, identity: str) -> EvaluationContext:
        """Create a new context with the specified identity."""
        return EvaluationContext(
            identity=identity,
            groups=self.groups.copy(),
            traits=self.traits.copy(),
            claims=self.claims.copy(),
            request=self.request,
            entity=self.entity,
        )

    def with_groups(self, *groups: str) -> EvaluationContext:
        """Create a new context with additional groups."""
        return EvaluationContext(
            identity=self.identity,
            groups=list(set(self.groups + list(groups))),
            traits=self.traits.copy(),
            claims=self.claims.copy(),
            request=self.request,
            entity=self.entity,
        )

    def with_traits(self, **traits: Any) -> EvaluationContext:
        """Create a new context with additional traits."""
        merged_traits = {**self.traits, **traits}
        return EvaluationContext(
            identity=self.identity,
            groups=self.groups.copy(),
            traits=merged_traits,
            claims=self.claims.copy(),
            request=self.request,
            entity=self.entity,
        )

    def with_claims(self, claims: dict[str, str]) -> EvaluationContext:
        """Create a new context with the specified claims map."""
        return EvaluationContext(
            identity=self.identity,
            groups=self.groups.copy(),
            traits=self.traits.copy(),
            claims=dict(claims) if claims else {},
            request=self.request,
            entity=self.entity,
        )

    def with_request(self, request: RequestContext | None) -> EvaluationContext:
        """Create a new context with the specified request fields."""
        return EvaluationContext(
            identity=self.identity,
            groups=self.groups.copy(),
            traits=self.traits.copy(),
            claims=self.claims.copy(),
            request=request,
            entity=self.entity,
        )

    def with_entity(self, entity: TogglyEntityContext | None) -> EvaluationContext:
        """Create a new context with the specified entity."""
        return EvaluationContext(
            identity=self.identity,
            groups=self.groups.copy(),
            traits=self.traits.copy(),
            claims=self.claims.copy(),
            request=self.request,
            entity=entity,
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert context to a dictionary."""
        return {
            "identity": self.identity,
            "groups": self.groups,
            "traits": self.traits,
            "claims": self.claims,
            "request": None if self.request is None else self.request.to_dict(),
            "entity": None
            if self.entity is None
            else {
                "kind": self.entity.kind,
                "key": self.entity.key,
                "attributes": self.entity.attributes,
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvaluationContext:
        """Create a context from a dictionary."""
        entity_data = data.get("entity")
        entity = None
        if isinstance(entity_data, dict):
            entity = TogglyEntityContext(
                kind=str(entity_data.get("kind", "")),
                key=str(entity_data.get("key", "")),
                attributes=entity_data.get("attributes") or {},
            )
        claims_raw = data.get("claims") or {}
        claims = {str(k): str(v) for k, v in claims_raw.items()} if isinstance(claims_raw, dict) else {}
        request_data = data.get("request")
        request = RequestContext.from_dict(request_data) if isinstance(request_data, dict) else None
        return cls(
            identity=data.get("identity"),
            groups=data.get("groups", []),
            traits=data.get("traits", {}),
            claims=claims,
            request=request,
            entity=entity,
        )

    @classmethod
    def anonymous(cls) -> EvaluationContext:
        """Create an anonymous evaluation context."""
        return cls()

    def __bool__(self) -> bool:
        """Check if context has any meaningful data."""
        return bool(
            self.identity
            or self.groups
            or self.traits
            or self.claims
            or self.request
            or self.entity
        )
