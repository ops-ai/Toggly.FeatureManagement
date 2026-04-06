"""Tests for HTTP URL helpers."""

from toggly.http import build_definitions_url, build_evaluated_variants_url


def test_build_evaluated_variants_url_without_identity() -> None:
    """Variants URL has no query when identity is omitted."""
    url = build_evaluated_variants_url(
        "https://definitions.toggly.io",
        "app-key-1",
        "Production",
        identity=None,
    )
    assert url == (
        "https://definitions.toggly.io/evaluated-variants-signed/app-key-1/Production"
    )


def test_build_evaluated_variants_url_with_identity() -> None:
    """Variants URL uses userId query parameter."""
    url = build_evaluated_variants_url(
        "https://definitions.toggly.io/",
        "app-key-1",
        "Staging",
        identity="user@example.com",
    )
    assert "evaluated-variants-signed/app-key-1/Staging" in url
    assert "userId=user%40example.com" in url


def test_build_definitions_url_quote_identity() -> None:
    """Definitions URL still builds with identity query."""
    url = build_definitions_url(
        "https://definitions.toggly.io",
        "k",
        "Production",
        identity="a/b",
    )
    assert "identity=a%2Fb" in url
