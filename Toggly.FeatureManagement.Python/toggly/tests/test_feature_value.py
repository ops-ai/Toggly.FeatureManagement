"""Tests for the catalog ``valueType`` field and typed flag getters (OPS-2102)."""

from __future__ import annotations

import pytest

from toggly import (
    AsyncTogglyClient,
    FeatureDefinition,
    FeatureFilter,
    MemorySnapshotProvider,
    TogglyClient,
    TogglyConfig,
)
from toggly.feature_value_codec import (
    decode_datetime_value,
    decode_json_value,
    decode_number_value,
    decode_string_value,
    is_feature_value_type,
    value_type_matches,
)
from toggly.providers import DefinitionsSnapshot


class TestFeatureValueCodec:
    """Unit tests for the soft-decode helpers, independent of the client."""

    def test_is_feature_value_type(self) -> None:
        """Recognized FeatureValueType strings return True; others False."""
        assert is_feature_value_type("string") is True
        assert is_feature_value_type("datetime") is True
        assert is_feature_value_type("float") is False
        assert is_feature_value_type(None) is False

    def test_value_type_matches_allows_legacy_catalogs(self) -> None:
        """No declared valueType (legacy catalogs) always allows a decode attempt."""
        assert value_type_matches(None, "string") is True
        assert value_type_matches("", "number") is True

    def test_value_type_matches_rejects_declared_mismatch(self) -> None:
        """A declared valueType that differs from the requested type is rejected."""
        assert value_type_matches("number", "string") is False
        assert value_type_matches("string", "string") is True

    def test_decode_string_value(self) -> None:
        """Decodes plain strings; soft-nulls non-strings and declared mismatches."""
        assert decode_string_value("hello") == "hello"
        assert decode_string_value(42) is None
        assert decode_string_value("hello", declared="number") is None

    def test_decode_number_value(self) -> None:
        """Decodes numeric values and numeric strings; bool is never a number."""
        assert decode_number_value(42) == 42.0
        assert decode_number_value("3.14") == 3.14
        assert decode_number_value(True) is None  # bool is not a number
        assert decode_number_value("not-a-number") is None
        assert decode_number_value(42, declared="string") is None

    def test_decode_json_value(self) -> None:
        """Decodes dict/list values and JSON-object/array strings only."""
        assert decode_json_value({"a": 1}) == {"a": 1}
        assert decode_json_value('{"a": 1}') == {"a": 1}
        assert decode_json_value("not json") is None
        assert decode_json_value('"a plain string"') is None
        assert decode_json_value({"a": 1}, declared="string") is None

    def test_decode_datetime_value_iso8601(self) -> None:
        """Parses an ISO-8601 string with a Z suffix into a datetime."""
        decoded = decode_datetime_value("2026-01-15T10:30:00Z")
        assert decoded is not None
        assert decoded.year == 2026
        assert decoded.month == 1
        assert decoded.day == 15

    def test_decode_datetime_value_soft_nulls_on_bad_input(self) -> None:
        """Non-ISO-8601 strings and non-string/datetime inputs soft-null."""
        assert decode_datetime_value("not-a-date") is None
        assert decode_datetime_value(12345) is None
        assert decode_datetime_value("2026-01-15T10:30:00Z", declared="string") is None


class TestTypedFlagGetters:
    """Tests for TogglyClient.get_{string,number,json,datetime}_value."""

    def _client_with(self, definition: FeatureDefinition) -> TogglyClient:
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(definitions=[definition]))
        client = TogglyClient(TogglyConfig(snapshot_provider=provider))
        client.init()
        return client

    def test_get_string_value_matches_declared_type(self) -> None:
        """String value decodes when the declared valueType is string."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="greeting",
                filters=[FeatureFilter(name="AlwaysOn")],
                value_type="string",
                value="hello",
            )
        )
        try:
            assert client.get_string_value("greeting") == "hello"
        finally:
            client.close()

    def test_get_string_value_soft_nulls_on_declared_mismatch(self) -> None:
        """A declared non-string valueType soft-nulls get_string_value."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="limit",
                filters=[FeatureFilter(name="AlwaysOn")],
                value_type="number",
                value=42,
            )
        )
        try:
            assert client.get_string_value("limit") is None
            assert client.get_string_value("limit", default="fallback") == "fallback"
        finally:
            client.close()

    def test_get_number_value(self) -> None:
        """Numeric values decode to float when the declared type matches."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="limit",
                filters=[FeatureFilter(name="AlwaysOn")],
                value_type="number",
                value=42,
            )
        )
        try:
            assert client.get_number_value("limit") == 42.0
        finally:
            client.close()

    def test_get_json_value(self) -> None:
        """JSON object values decode to a dict when the declared type matches."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="config",
                filters=[FeatureFilter(name="AlwaysOn")],
                value_type="json",
                value={"nested": {"flag": True}},
            )
        )
        try:
            assert client.get_json_value("config") == {"nested": {"flag": True}}
        finally:
            client.close()

    def test_get_datetime_value_parses_iso8601(self) -> None:
        """Flag value decodes from ISO-8601 into a datetime via the client."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="launch-at",
                filters=[FeatureFilter(name="AlwaysOn")],
                value_type="datetime",
                value="2026-06-01T00:00:00Z",
            )
        )
        try:
            decoded = client.get_datetime_value("launch-at")
            assert decoded is not None
            assert decoded.year == 2026 and decoded.month == 6 and decoded.day == 1
        finally:
            client.close()

    def test_get_datetime_value_soft_nulls_on_unparsable_value(self) -> None:
        """A non-ISO-8601 value soft-nulls instead of raising."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="launch-at",
                filters=[FeatureFilter(name="AlwaysOn")],
                value_type="datetime",
                value="not-a-date",
            )
        )
        try:
            assert client.get_datetime_value("launch-at") is None
        finally:
            client.close()

    def test_soft_nulls_on_disabled_flag(self) -> None:
        """A disabled flag soft-nulls every typed getter."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="greeting",
                filters=[FeatureFilter(name="AlwaysOff")],
                value_type="string",
                value="hello",
            )
        )
        try:
            assert client.get_string_value("greeting") is None
        finally:
            client.close()

    def test_soft_nulls_on_missing_feature(self) -> None:
        """An unknown feature key soft-nulls every typed getter."""
        client = TogglyClient()
        assert client.get_string_value("unknown") is None
        assert client.get_number_value("unknown") is None
        assert client.get_json_value("unknown") is None
        assert client.get_datetime_value("unknown") is None

    def test_legacy_catalog_without_value_type_still_decodes(self) -> None:
        """Catalogs predating `valueType` still attempt the typed decode."""
        client = self._client_with(
            FeatureDefinition(
                feature_key="greeting",
                filters=[FeatureFilter(name="AlwaysOn")],
                value="hello",
            )
        )
        try:
            assert client.get_string_value("greeting") == "hello"
        finally:
            client.close()


class TestAsyncTypedFlagGetters:
    """Async client mirrors the sync typed-getter behavior."""

    @pytest.mark.asyncio
    async def test_get_string_value_and_soft_null_on_mismatch(self) -> None:
        """Async client decodes a matching type and soft-nulls a mismatch."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="greeting",
                    filters=[FeatureFilter(name="AlwaysOn")],
                    value_type="string",
                    value="hello",
                ),
                FeatureDefinition(
                    feature_key="limit",
                    filters=[FeatureFilter(name="AlwaysOn")],
                    value_type="number",
                    value=42,
                ),
            ]
        ))
        client = AsyncTogglyClient(TogglyConfig(snapshot_provider=provider))
        await client.init()
        try:
            assert await client.get_string_value("greeting") == "hello"
            assert await client.get_string_value("limit") is None
            assert await client.get_number_value("limit") == 42.0
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_soft_nulls_on_missing_feature(self) -> None:
        """An unknown feature key soft-nulls every async typed getter."""
        client = AsyncTogglyClient()
        assert await client.get_string_value("unknown") is None
        assert await client.get_datetime_value("unknown") is None
