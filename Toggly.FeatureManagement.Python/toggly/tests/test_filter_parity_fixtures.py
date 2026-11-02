"""Golden filter-parity fixtures from docs/filter-parity/fixtures/."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from toggly.context import EvaluationContext, HttpRequestMapper
from toggly.evaluator import EvaluationEngine
from toggly.models import FeatureDefinition, FeatureFilter

REQUIRED_IDS = {
    "browser-family-match",
    "browser-family-miss",
    "browser-language-match",
    "country-from-request",
    "country-from-cf-ipcountry",
    "device-type-match",
    "os-match",
    "user-claims-match",
    "user-claims-miss",
    "targeting-groups-match",
    "percentage-missing-fail-closed",
    "percentage-zero-fail-closed",
    "unknown-filter-fail-closed",
}


def _resolve_fixtures_dir() -> Path | None:
    """Resolve fixtures from the FeatureManagement repo root."""
    cwd = Path.cwd().resolve()
    candidates = [
        cwd / "docs" / "filter-parity" / "fixtures",
        cwd / ".." / "docs" / "filter-parity" / "fixtures",
        cwd / ".." / ".." / "docs" / "filter-parity" / "fixtures",
        cwd / ".." / ".." / ".." / "docs" / "filter-parity" / "fixtures",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate.resolve()

    walk = cwd
    for _ in range(6):
        candidate = walk / "docs" / "filter-parity" / "fixtures"
        if candidate.is_dir():
            return candidate.resolve()
        if walk.parent == walk:
            break
        walk = walk.parent
    return None


def _load_fixtures() -> list[tuple[str, dict[str, Any]]]:
    directory = _resolve_fixtures_dir()
    assert directory is not None, "docs/filter-parity/fixtures not found"
    fixtures: list[tuple[str, dict[str, Any]]] = []
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        fixtures.append((data["id"], data))
    return fixtures


def _to_definition(root: dict[str, Any]) -> FeatureDefinition:
    filters = [
        FeatureFilter(name=f["name"], parameters=f.get("parameters") or {})
        for f in root.get("filters") or []
    ]
    return FeatureDefinition(
        feature_key=root["featureKey"],
        filters=filters,
        requirement_type=root.get("requirementType") or "Any",
    )


def _to_context(root: dict[str, Any]) -> EvaluationContext:
    context_data = root.get("context") or {}
    base = EvaluationContext.from_dict(context_data)
    headers = root.get("httpHeaders")
    if isinstance(headers, dict) and headers:
        return HttpRequestMapper.merge_into(headers, base)
    return base


def test_loads_required_wave1_cases() -> None:
    """Ensure required golden fixture IDs are present."""
    ids = {fixture_id for fixture_id, _ in _load_fixtures()}
    for required in REQUIRED_IDS:
        assert required in ids, f"missing fixture {required}"


@pytest.mark.parametrize("fixture_id,root", _load_fixtures(), ids=lambda p: p[0] if isinstance(p, tuple) else str(p))
def test_golden_fixture(fixture_id: str, root: dict[str, Any]) -> None:
    """Assert Python eval matches each shared golden fixture."""
    engine = EvaluationEngine()
    definition = _to_definition(root)
    context = _to_context(root)
    expected = bool(root["expected"])
    actual = engine.evaluate(definition, context)
    assert actual is expected, f"fixture {fixture_id} failed"
