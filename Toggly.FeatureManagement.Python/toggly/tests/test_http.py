"""Tests for HTTP URL helpers."""

from toggly.http import build_definitions_url


def test_build_definitions_url_quote_identity() -> None:
    """Definitions URL still builds with identity query."""
    url = build_definitions_url(
        "https://definitions.toggly.io",
        "k",
        "Production",
        identity="a/b",
    )
    assert "identity=a%2Fb" in url
