"""Unit tests for shared definition-cache helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from toggly.definition_cache import (
    ConditionalGetHit,
    HttpCacheKind,
    SignedDefinitionsEnvelope,
    StaleSignedHit,
    UnsignedDefinitionsParsed,
    build_definitions_snapshot,
    cached_flags_response,
    cached_hit_result,
    decode_json_text,
    decode_response_json,
    definitions_from_signed_envelope,
    extract_raw_defs_json,
    fetched_definitions_result,
    fetched_variants_result,
    if_none_match_headers,
    is_stale_signed_timestamp,
    normalize_revision,
    parse_definitions_payload,
    parse_evaluated_variants_payload,
    parse_signed_definitions_envelope,
    parse_signed_timestamp,
    prepare_definitions_body,
    probe_http_cache,
    resolve_conditional_get,
    revisions_match,
)
from toggly.enums import LoadStatus
from toggly.exceptions import TogglyNetworkError, TogglySignatureError
from toggly.models import EvaluatedVariantDef


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
        probe = probe_http_cache(200, "r1", {"etag": "r1"})
        assert probe.kind is HttpCacheKind.SAME_REVISION

    def test_resolve_conditional_get(self) -> None:
        hit_304 = resolve_conditional_get(
            probe_http_cache(304, '"r"', {"ETag": '"r"'}),
            resource_label="definitions",
        )
        assert hit_304 == ConditionalGetHit(etag_to_store=None)

        hit_same = resolve_conditional_get(
            probe_http_cache(200, '"r"', {"ETag": '"r"'}),
            resource_label="definitions",
        )
        assert hit_same == ConditionalGetHit(etag_to_store='"r"')

        assert (
            resolve_conditional_get(
                probe_http_cache(200, '"r1"', {"ETag": '"r2"'}),
                resource_label="definitions",
            )
            is None
        )

        with pytest.raises(TogglyNetworkError, match="evaluated variants"):
            resolve_conditional_get(
                probe_http_cache(503, None, {}),
                resource_label="evaluated variants",
            )

    def test_cached_flags_and_hit_result(self) -> None:
        resp = cached_flags_response({"f": True})
        assert resp.status == LoadStatus.CACHED
        assert resp.flags == {"f": True}
        triple = cached_hit_result({"f": True})
        assert triple[1] == "hit"
        assert triple[2] is None

    def test_decode_json_helpers(self) -> None:
        assert decode_json_text("[1]") == [1]
        with pytest.raises(TogglyNetworkError, match="Invalid JSON"):
            decode_json_text("{")

        ok = MagicMock()
        ok.json.return_value = {"a": 1}
        assert decode_response_json(ok) == {"a": 1}
        bad = MagicMock()
        bad.json.side_effect = ValueError("boom")
        with pytest.raises(TogglyNetworkError, match="Invalid JSON"):
            decode_response_json(bad)

    def test_extract_raw_defs_json(self) -> None:
        body = '{"defs":[{"featureKey":"a"}],"signature":"x"}'
        raw = extract_raw_defs_json(body)
        assert raw == '[{"featureKey":"a"}]'
        assert extract_raw_defs_json("{}") is None
        assert extract_raw_defs_json('{"defs": ') is None
        assert extract_raw_defs_json('{"defs": "nope"}') is None
        # object-shaped defs
        assert extract_raw_defs_json('{"defs":{"a":1}}') == '{"a":1}'
        # whitespace after colon
        assert extract_raw_defs_json('{"defs" :   [1]}') == "[1]"

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
        assert parse_definitions_payload([None, "x"]) == []

    def test_parse_signed_timestamp_and_stale(self) -> None:
        assert parse_signed_timestamp(True) is None
        assert parse_signed_timestamp(12.5) == 12
        assert parse_signed_timestamp(7) == 7
        assert parse_signed_timestamp("x") is None
        assert is_stale_signed_timestamp(5, 10) is True
        assert is_stale_signed_timestamp(10, 10) is False
        assert is_stale_signed_timestamp(5, 0) is False

    def test_prepare_unsigned_and_signed_envelope(self) -> None:
        unsigned = prepare_definitions_body(
            '[{"featureKey":"a","filters":[{"name":"AlwaysOn","parameters":{}}]}]',
            use_signed=False,
            last_signed_timestamp=0,
        )
        assert isinstance(unsigned, UnsignedDefinitionsParsed)
        assert unsigned.definitions[0].feature_key == "a"

        signed_body = (
            '{"defs":[{"featureKey":"a","filters":[{"name":"AlwaysOn","parameters":{}}]}],'
            '"signature":"sig","kid":"k1","timestamp":100}'
        )
        prepared = prepare_definitions_body(
            signed_body, use_signed=True, last_signed_timestamp=0
        )
        assert isinstance(prepared, SignedDefinitionsEnvelope)
        stale = prepare_definitions_body(
            signed_body, use_signed=True, last_signed_timestamp=200
        )
        assert isinstance(stale, StaleSignedHit)

        with pytest.raises(TogglySignatureError, match="object"):
            parse_signed_definitions_envelope("[]", [])
        with pytest.raises(TogglySignatureError, match="defs"):
            parse_signed_definitions_envelope("{}", {"signature": "s", "kid": "k", "timestamp": 1})
        with pytest.raises(TogglySignatureError, match="signature"):
            parse_signed_definitions_envelope(
                '{"defs":[]}', {"defs": [], "kid": "k", "timestamp": 1}
            )
        with pytest.raises(TogglySignatureError, match="kid"):
            parse_signed_definitions_envelope(
                '{"defs":[]}', {"defs": [], "signature": "s", "timestamp": 1}
            )
        with pytest.raises(TogglySignatureError, match="timestamp"):
            parse_signed_definitions_envelope(
                '{"defs":[]}', {"defs": [], "signature": "s", "kid": "k"}
            )

    def test_definitions_from_envelope_and_snapshots(self) -> None:
        envelope = SignedDefinitionsEnvelope(
            signed_defs_json='[{"featureKey":"z","filters":[{"name":"AlwaysOn","parameters":{}}]}]',
            signature="sig",
            kid="kid",
            signed_ts=42,
        )
        defs = definitions_from_signed_envelope(envelope)
        assert defs[0].feature_key == "z"
        snap = build_definitions_snapshot(defs, etag='"e"', signed_ts=42, signature="sig", kid="kid")
        assert snap.etag == '"e"'
        assert snap.timestamp == 42

        fetched = fetched_definitions_result({"z": True}, defs, etag='"e"')
        assert fetched[1] == "miss"
        assert fetched[0].status == LoadStatus.FETCHED

    def test_parse_evaluated_variants_and_fetched_result(self) -> None:
        assert parse_evaluated_variants_payload("bad") == ({}, None, None, None)
        defs, sig, ts, kid = parse_evaluated_variants_payload(
            {
                "defs": {
                    "feat": {"enabled": True, "value": "A"},
                },
                "signature": "s",
                "timestamp": 3.2,
                "kid": "k",
            }
        )
        assert isinstance(defs["feat"], EvaluatedVariantDef)
        assert sig == "s"
        assert ts == 3
        assert kid == "k"
        # int timestamp path
        _, _, ts2, _ = parse_evaluated_variants_payload({"defs": {}, "timestamp": 9})
        assert ts2 == 9
        _, _, ts3, _ = parse_evaluated_variants_payload({"defs": {}, "timestamp": "x"})
        assert ts3 is None

        result = fetched_variants_result(
            {"feat": True},
            defs,
            etag='"v"',
            signature="s",
            kid="k",
            timestamp=3,
        )
        assert result[1] == "miss"
        assert result[2].etag == '"v"'

    def test_verify_and_parse_signed_envelope(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from toggly.definition_cache import verify_and_parse_signed_envelope

        called = {"n": 0}

        def fake_verify(*_a: Any, **_k: Any) -> None:
            called["n"] += 1

        monkeypatch.setattr(
            "toggly.definition_cache.verify_signed_definitions",
            fake_verify,
        )
        envelope = SignedDefinitionsEnvelope(
            signed_defs_json='[{"featureKey":"z","filters":[{"name":"AlwaysOn","parameters":{}}]}]',
            signature="sig",
            kid="kid",
            signed_ts=42,
        )
        definitions, signature, kid, signed_ts, raw = verify_and_parse_signed_envelope(
            envelope, jwks=MagicMock(), allowed_key_ids=None
        )
        assert called["n"] == 1
        assert definitions[0].feature_key == "z"
        assert signature == "sig"
        assert kid == "kid"
        assert signed_ts == 42
        assert raw == envelope.signed_defs_json
