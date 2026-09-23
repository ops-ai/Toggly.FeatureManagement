r"""Catalog-local variant allocator — bit-for-bit parity with `Microsoft.FeatureManagement` 4.7.0.

Assignment precedence (`Microsoft.FeatureManagement.FeatureManager.GetVariantAsync`):

1. Disabled feature (``enabled=False``): assign only ``DefaultWhenDisabled``.
2. Enabled feature: User → Group → Percentile → ``DefaultWhenEnabled``.
3. No ``Allocation`` configured: no variant assigned (`DefaultWhen*` reason only).

Percentile hashing is strict MF parity:

- Context id: ``"{userId}\\n{hint}"`` where ``hint`` is ``Allocation.Seed`` when
  set, else ``"allocation\\n{featureName}"``.
- ``userId`` is lowercased when ``ignore_case`` is True (MF's assigner default).
- SHA-256 over the UTF-8 encoded context id; the first 4 digest bytes are read
  as a little-endian ``uint32``; ``contextPercentage = (marker / uint32.max) * 100``.
- A percentile bucket ``[from, to)`` matches when ``from <= pct < to``, except
  ``to == 100`` also matches ``pct == 100`` (inclusive upper edge).

This module intentionally has no dependency on HTTP/caching/telemetry so it can
be replayed against ``variant-allocator-corpus/cases.json`` in isolation.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Optional

from toggly.models import (
    VARIANT_STATUS_OVERRIDE_DISABLED,
    VARIANT_STATUS_OVERRIDE_ENABLED,
    Allocation,
    FeatureDefinition,
    Variant,
)

#: uint32 max, matching .NET's ``uint.MaxValue`` used by MF's percentile hash.
_UINT32_MAX = 0xFFFFFFFF

#: Assignment reasons, matching `Microsoft.FeatureManagement.VariantAssignmentReason`.
REASON_NONE = "None"
REASON_USER = "User"
REASON_GROUP = "Group"
REASON_PERCENTILE = "Percentile"
REASON_DEFAULT_WHEN_ENABLED = "DefaultWhenEnabled"
REASON_DEFAULT_WHEN_DISABLED = "DefaultWhenDisabled"


@dataclass(frozen=True)
class VariantAssignment:
    """Result of MF-parity variant assignment for a single feature."""

    variant: Optional[Variant]
    """The assigned variant, or ``None`` when no variant could be resolved."""

    enabled: bool
    """Effective enabled state after applying the assigned variant's ``StatusOverride``."""

    reason: str
    """One of the ``REASON_*`` constants."""


def compute_variant_percentile(user_id: str, hint: str) -> float:
    r"""Compute the MF ``TargetingEvaluator`` percentile bucket in ``[0, 100)``.

    Args:
        user_id: Targeting user id (already lowercased by the caller when
            case-insensitive matching applies).
        hint: ``Allocation.Seed`` when set, else ``"allocation\n{featureName}"``.

    Returns:
        A percentage in ``[0, 100)`` (theoretically up to but not including 100,
        though the caller's ``to == 100`` bucket handles the inclusive edge).

    """
    context_id = f"{user_id}\n{hint}"
    digest = hashlib.sha256(context_id.encode("utf-8")).digest()
    marker = int.from_bytes(digest[:4], byteorder="little", signed=False)
    return (marker / float(_UINT32_MAX)) * 100.0


def _find_variant(variants: list[Variant], name: str | None) -> Variant | None:
    if not name:
        return None
    for v in variants:
        if v.name == name:
            return v
    return None


def _match_user(allocation: Allocation, user_id: str | None, ignore_case: bool) -> str | None:
    if not user_id:
        return None
    for ua in allocation.user:
        if ignore_case:
            if user_id.lower() in {u.lower() for u in ua.users}:
                return ua.variant
        elif user_id in ua.users:
            return ua.variant
    return None


def _match_group(
    allocation: Allocation, groups: list[str], ignore_case: bool
) -> str | None:
    if not groups:
        return None
    for ga in allocation.group:
        if ignore_case:
            candidates = {g.lower() for g in ga.groups}
            if any(g.lower() in candidates for g in groups):
                return ga.variant
        else:
            candidates_cs = set(ga.groups)
            if any(g in candidates_cs for g in groups):
                return ga.variant
    return None


def _match_percentile(
    allocation: Allocation,
    feature_key: str,
    user_id: str | None,
    ignore_case: bool,
) -> str | None:
    if not allocation.percentile:
        return None
    resolved_user_id = user_id or ""
    if ignore_case:
        resolved_user_id = resolved_user_id.lower()
    hint = allocation.seed if allocation.seed else f"allocation\n{feature_key}"
    pct = compute_variant_percentile(resolved_user_id, hint)
    for pa in allocation.percentile:
        if pa.from_ <= pct < pa.to:
            return pa.variant
        if pa.to == 100 and pct >= pa.from_:
            return pa.variant
    return None


def assign_variant(
    definition: FeatureDefinition,
    *,
    enabled: bool,
    user_id: str | None = None,
    groups: list[str] | None = None,
    ignore_case: bool = True,
) -> VariantAssignment:
    """Assign a variant to a feature, bit-for-bit matching MF 4.7.0.

    Args:
        definition: The feature definition (``variants`` + ``allocation``).
        enabled: The feature's filter-evaluated enabled state (before any
            ``StatusOverride``).
        user_id: Targeting user id, or ``None`` for anonymous.
        groups: Targeting groups, or ``None``/empty for none.
        ignore_case: Case-insensitive user/group matching (MF assigner default).

    Returns:
        The ``VariantAssignment`` (variant, effective enabled, reason).

    """
    variants = definition.variants
    allocation = definition.allocation
    groups = groups or []

    if not variants:
        return VariantAssignment(variant=None, enabled=enabled, reason=REASON_NONE)

    if allocation is None:
        reason = (
            REASON_DEFAULT_WHEN_ENABLED if enabled else REASON_DEFAULT_WHEN_DISABLED
        )
        return VariantAssignment(variant=None, enabled=enabled, reason=reason)

    variant_name: str | None

    if not enabled:
        variant_name = allocation.default_when_disabled
        reason = REASON_DEFAULT_WHEN_DISABLED
    else:
        variant_name = _match_user(allocation, user_id, ignore_case)
        if variant_name is not None:
            reason = REASON_USER
        else:
            variant_name = _match_group(allocation, groups, ignore_case)
            if variant_name is not None:
                reason = REASON_GROUP
            else:
                variant_name = _match_percentile(
                    allocation, definition.feature_key, user_id, ignore_case
                )
                if variant_name is not None:
                    reason = REASON_PERCENTILE
                else:
                    variant_name = allocation.default_when_enabled
                    reason = REASON_DEFAULT_WHEN_ENABLED

    variant = _find_variant(variants, variant_name)

    effective_enabled = enabled
    if variant is not None:
        if variant.status_override == VARIANT_STATUS_OVERRIDE_ENABLED:
            effective_enabled = True
        elif variant.status_override == VARIANT_STATUS_OVERRIDE_DISABLED:
            effective_enabled = False

    return VariantAssignment(variant=variant, enabled=effective_enabled, reason=reason)
