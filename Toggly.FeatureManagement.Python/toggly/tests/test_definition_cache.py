"""Unit tests for shared definition-cache helpers."""

from __future__ import annotations

from toggly.definition_cache import (
    HttpCacheKind,
    cached_flags_response,
    extract_raw_defs_json,
    if_none_match_headers,
    normalize_revision,
    parse_definitions_payload,
    parse_signed_timestamp,
    probe_http_cache,
    revisions_match,
)
from toggly.enums import LoadStatus


class TestDefinitionCacheHelpers:
    def test_normalize_and_match_revisions(self) -> None:
        assert normalize_revision(None) is None
        assert normalize_revision('  "rev-1"  ') == "rev-1"
        assert revisions_match('"a"', "a") is True
        assert revisions_match("a", "b") is False
        assert revisions_match(None, "a") is False

    def test_if_none_match_headers(self) -> None:
        assert if_none_match_headers(None) == {}
        assert if_none_match_headers('"rev"') == {"If-None-Match": '"rev"'}

    def test_probe_http_cache_kinds(self) -> None:
        assert (
            probe_http_cache(304, '"r1"', {"ETag": '"r1"'}).kind
            is HttpCacheKind.NOT_MODIFIED
        )
        assert (
            probe_http_cache(500, '"r1"', {}).kind is HttpCacheKind.ERROR_STATUS
        )
        assert (
            probe_http_cache(200, '"r1"', {"ETag": '"r1"'}).kind
            is HttpCacheKind.SAME_REVISION
        )
        assert (
            probe_http_cache(200, '"r1"', {"ETag": '"r2"'}).kind
            is HttpCacheKind.NEW_CONTENT
        )
        # lowercase etag header
        probe = probe_http_cache(200, "r1", {"etag": "r1"})
        assert probe.kind is HttpCacheKind.SAME_REVISION

    def test_cached_flags_response(self) -> None:
        resp = cached_flags_response({"f": True})
        assert resp.status == LoadStatus.CACHED
        assert resp.flags == {"f": True}

    def test_extract_raw_defs_json(self) -> None:
        body = '{"defs":[{"featureKey":"a"}],"signature":"x"}'
        raw = extract_raw_defs_json(body)
        assert raw == '[{"featureKey":"a"}]'
        assert extract_raw_defs_json("{}") is None
        assert extract_raw_defs_json('{"defs": ') is None

    def test_parse_definitions_payload(self) -> None:
        defs = parse_definitions_payload(
            [
                {
                    "featureKey": "feat",
                    "filters": [{"name": "AlwaysOn", "parameters": {}}],
                }
            ]
        )
        assert len(defs) == 1
        assert defs[0].feature_key == "feat"
        assert parse_definitions_payload({"features": []}) == []
        assert parse_definitions_payload("bad") == []
        assert parse_definitions_payload([{"filters": []}]) == []

    def test_parse_signed_timestamp(self) -> None:
        assert parse_signed_timestamp(True) is None
        assert parse_signed_timestamp(12.5) == 12
        assert parse_signed_timestamp(7) == 7
        assert parse_signed_timestamp("x") is None
