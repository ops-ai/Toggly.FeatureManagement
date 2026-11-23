"""Non-string identity and null group slots in variant assignment."""

from toggly.models import (
    Allocation,
    FeatureDefinition,
    GroupAllocation,
    PercentileAllocation,
    UserAllocation,
    Variant,
)
from toggly.variants import (
    REASON_GROUP,
    REASON_PERCENTILE,
    _percentile_identity,
    assign_variant,
    compute_variant_percentile,
)


def _definition() -> FeatureDefinition:
    return FeatureDefinition(
        feature_key="flag",
        variants=[Variant(name="A"), Variant(name="B")],
        allocation=Allocation(
            default_when_enabled="B",
            user=[UserAllocation(variant="A", users=["42"])],
            group=[GroupAllocation(variant="A", groups=["beta"])],
            percentile=[PercentileAllocation(variant="A", from_=0, to=100)],
        ),
    )


def test_numeric_identity_does_not_throw_and_does_not_match_user_text() -> None:
    """Finite numeric ids fail closed for user equality and still hash."""
    assignment = assign_variant(
        _definition(), enabled=True, user_id=42, ignore_case=True
    )
    assert assignment.enabled is True
    assert assignment.reason == REASON_PERCENTILE
    assert assignment.variant is not None
    assert assignment.variant.name == "A"


def test_integer_zero_hashes_as_decimal_text() -> None:
    """0 is a finite id. It must not take the anonymous empty-string bucket."""
    hint = "allocation\nflag"
    hashed = _percentile_identity(0, False)
    assert hashed == "0"
    assert compute_variant_percentile(hashed, hint) == compute_variant_percentile(
        "0", hint
    )
    assert compute_variant_percentile(hashed, hint) != compute_variant_percentile(
        "", hint
    )
    assert _percentile_identity(False, False) == ""
    assert _percentile_identity(None, False) == ""


def test_null_group_slot_does_not_throw_and_real_group_matches() -> None:
    """A null slot is skipped; a neighboring group name still matches."""
    beside = assign_variant(
        _definition(),
        enabled=True,
        user_id="other",
        groups=[None, "beta"],
        ignore_case=True,
    )
    assert beside.enabled is True
    assert beside.reason == REASON_GROUP
    assert beside.variant is not None
    assert beside.variant.name == "A"

    alone = assign_variant(
        _definition(),
        enabled=True,
        user_id="other",
        groups=[None],
        ignore_case=True,
    )
    assert alone.enabled is True
    assert alone.reason == REASON_PERCENTILE
