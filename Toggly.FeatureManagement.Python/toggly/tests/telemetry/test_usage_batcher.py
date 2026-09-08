"""Tests for usage batcher and identity hashing."""

from toggly.telemetry import UsageBatcher, hash_identity


class TestHashIdentity:
    def test_fnv1a_utf8_signed_int32_matches_go(self) -> None:
        alice = hash_identity("alice")
        assert isinstance(alice, int)
        assert alice == hash_identity("alice")
        assert alice != hash_identity("bob")

        # Go hash/fnv New32a on []byte(s), cast to int32
        assert alice == -2027809817
        assert hash_identity("café") == -1473556407
        assert hash_identity("🚀") == 2141686490

    def test_utf8_differs_from_code_unit_hashing(self) -> None:
        # UTF-16 / charCodeAt style must not match UTF-8 FNV-1a for multi-byte
        value = "café"
        utf16_style = 2166136261
        for ch in value:
            utf16_style ^= ord(ch)
            utf16_style = (utf16_style * 16777619) & 0xFFFFFFFF
        utf16_signed = (
            utf16_style - 0x100000000 if utf16_style > 0x7FFFFFFF else utf16_style
        )
        assert hash_identity(value) != utf16_signed


class TestUsageBatcher:
    def test_aggregates_checks_into_variant_stats(self) -> None:
        batcher = UsageBatcher(
            "app",
            "Production",
            instance_name="host-1",
            app_version="1.2.3",
        )

        batcher.record_check("FeatureA", True, "user-1")
        batcher.record_check("FeatureA", True, "user-1")
        batcher.record_check("FeatureA", False, "user-2")
        batcher.record_usage("FeatureA", "user-1")
        batcher.record_view("FeatureA", "user-3")

        payload = batcher.build_and_reset()
        assert payload is not None
        assert payload["appKey"] == "app"
        assert payload["environment"] == "Production"
        assert payload["instanceName"] == "host-1"
        assert payload["appVersion"] == "1.2.3"
        assert payload["processStartTime"] is not None
        assert len(payload["stats"]) == 1

        stat = payload["stats"][0]
        assert stat["feature"] == "FeatureA"
        assert stat["variantStats"]["enabled"]["checkCount"] == 2
        assert stat["variantStats"]["enabled"]["requestCount"] == 0
        assert stat["variantStats"]["enabled"]["usedCount"] == 1
        assert stat["variantStats"]["enabled"]["viewedCount"] == 1
        assert stat["variantStats"]["disabled"]["checkCount"] == 1
        assert stat["uniqueContextIdentifierEnabledCount"] == 1
        assert stat["uniqueContextIdentifierDisabledCount"] == 1
        assert stat["uniqueUsersUsedCount"] == 1
        assert hash_identity("user-1") in stat["uniqueUserHashes"]
        assert hash_identity("user-3") in stat["uniqueViewedUserHashes"]
        assert set(payload["uniqueUserHashes"]) == {
            hash_identity("user-1"),
            hash_identity("user-2"),
            hash_identity("user-3"),
        }

        assert batcher.build_and_reset() is None

    def test_request_count_only_when_unique_request(self) -> None:
        batcher = UsageBatcher("app", "Production")
        batcher.record_check("FeatureA", True, "user-1", unique_request=True)
        batcher.record_check("FeatureA", True, "user-1", unique_request=False)
        batcher.record_check("FeatureA", False, "user-2", unique_request=True)

        payload = batcher.build_and_reset()
        assert payload is not None
        assert payload["stats"][0]["variantStats"]["enabled"]["checkCount"] == 2
        assert payload["stats"][0]["variantStats"]["enabled"]["requestCount"] == 1
        assert payload["stats"][0]["variantStats"]["disabled"]["checkCount"] == 1
        assert payload["stats"][0]["variantStats"]["disabled"]["requestCount"] == 1

    def test_custom_variant_name(self) -> None:
        batcher = UsageBatcher("app", "Production")
        batcher.record_check("FeatureA", True, variant="control")
        payload = batcher.build_and_reset()
        assert payload is not None
        assert payload["stats"][0]["variantStats"]["control"]["checkCount"] == 1
        assert "enabled" not in payload["stats"][0]["variantStats"]

    def test_definition_cache_fields_on_flush(self) -> None:
        batcher = UsageBatcher("app", "Production")
        batcher.record_definition_cache_hit()
        batcher.record_definition_cache_hit()
        batcher.record_definition_cache_miss()

        assert not batcher.is_empty()
        payload = batcher.build_and_reset()
        assert payload is not None
        assert payload["definitionCacheHits"] == 2
        assert payload["definitionCacheMisses"] == 1
        assert payload["stats"] == []
        assert batcher.is_empty()
        assert batcher.build_and_reset() is None

    def test_cache_only_batch_is_not_empty(self) -> None:
        batcher = UsageBatcher("app", "Production")
        batcher.record_definition_cache_hit()
        assert not batcher.is_empty()
        assert batcher.build_and_reset()["definitionCacheHits"] == 1

    def test_restore_merges_drained_snapshot(self) -> None:
        batcher = UsageBatcher("app", "Production")
        batcher.record_check("FeatureA", True, "user-1")
        batcher.record_definition_cache_hit()
        batcher.record_definition_cache_miss()

        drained = batcher.export_and_reset()
        assert drained is not None
        payload, snapshot = drained

        batcher.record_check("FeatureB", False, "user-2")
        batcher.record_definition_cache_hit()
        batcher.restore(snapshot)

        retried = batcher.build_and_reset()
        assert retried is not None
        assert retried["definitionCacheHits"] == 2
        assert retried["definitionCacheMisses"] == 1
        features = {s["feature"] for s in retried["stats"]}
        assert features == {"FeatureA", "FeatureB"}
        assert payload["definitionCacheHits"] == 1
