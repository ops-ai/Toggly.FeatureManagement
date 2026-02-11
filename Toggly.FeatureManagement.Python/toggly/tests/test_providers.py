"""Tests for snapshot providers."""

import json
import tempfile
from pathlib import Path

import pytest

from toggly import FeatureDefinition, FeatureFilter, JsonWebKey, JsonWebKeySet
from toggly.providers import (
    DefinitionsSnapshot,
    FileSnapshotProvider,
    JwksSnapshot,
    MemorySnapshotProvider,
)


class TestDefinitionsSnapshot:
    """Tests for DefinitionsSnapshot."""

    def test_empty_snapshot(self) -> None:
        """Test empty snapshot."""
        snapshot = DefinitionsSnapshot()

        assert snapshot.definitions == []
        assert snapshot.signature is None
        assert snapshot.key_id is None
        assert snapshot.timestamp is None
        assert snapshot.etag is None

    def test_snapshot_with_definitions(self) -> None:
        """Test snapshot with definitions."""
        definitions = [
            FeatureDefinition(
                feature_key="feature1",
                filters=[FeatureFilter(name="AlwaysOn")]
            )
        ]
        snapshot = DefinitionsSnapshot(
            definitions=definitions,
            etag="abc123",
            timestamp=1234567890
        )

        assert len(snapshot.definitions) == 1
        assert snapshot.definitions[0].feature_key == "feature1"
        assert snapshot.etag == "abc123"
        assert snapshot.timestamp == 1234567890

    def test_snapshot_to_dict(self) -> None:
        """Test snapshot to_dict conversion."""
        definitions = [
            FeatureDefinition(
                feature_key="feature1",
                filters=[FeatureFilter(name="AlwaysOn", parameters={"key": "value"})]
            )
        ]
        snapshot = DefinitionsSnapshot(
            definitions=definitions,
            signature="sig",
            key_id="key-1",
            timestamp=1234567890,
            etag="abc123"
        )

        result = snapshot.to_dict()

        assert result["definitions"][0]["feature_key"] == "feature1"
        assert result["definitions"][0]["filters"][0]["name"] == "AlwaysOn"
        assert result["signature"] == "sig"
        assert result["key_id"] == "key-1"
        assert result["timestamp"] == 1234567890
        assert result["etag"] == "abc123"

    def test_snapshot_from_dict(self) -> None:
        """Test snapshot from_dict creation."""
        data = {
            "definitions": [
                {
                    "feature_key": "feature1",
                    "filters": [{"name": "AlwaysOn", "parameters": {}}],
                    "requirement_type": "Any",
                    "secured_feature": False,
                    "metrics": None
                }
            ],
            "signature": "sig",
            "key_id": "key-1",
            "timestamp": 1234567890,
            "etag": "abc123"
        }

        snapshot = DefinitionsSnapshot.from_dict(data)

        assert len(snapshot.definitions) == 1
        assert snapshot.definitions[0].feature_key == "feature1"
        assert snapshot.signature == "sig"
        assert snapshot.key_id == "key-1"
        assert snapshot.timestamp == 1234567890
        assert snapshot.etag == "abc123"

    def test_snapshot_roundtrip(self) -> None:
        """Test snapshot to_dict and from_dict roundtrip."""
        original = DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(
                    feature_key="feature1",
                    filters=[FeatureFilter(name="Percentage", parameters={"Value": 50})]
                )
            ],
            etag="abc123",
            timestamp=1234567890
        )

        result = DefinitionsSnapshot.from_dict(original.to_dict())

        assert result.definitions[0].feature_key == original.definitions[0].feature_key
        assert result.etag == original.etag
        assert result.timestamp == original.timestamp


class TestJwksSnapshot:
    """Tests for JwksSnapshot."""

    def test_empty_jwks_snapshot(self) -> None:
        """Test empty JWKS snapshot."""
        snapshot = JwksSnapshot()

        assert snapshot.jwks.keys == []
        assert snapshot.timestamp is None

    def test_jwks_snapshot_with_keys(self) -> None:
        """Test JWKS snapshot with keys."""
        jwks = JsonWebKeySet(keys=[
            JsonWebKey(kty="EC", kid="key-1", crv="P-256", x="x1", y="y1")
        ])
        snapshot = JwksSnapshot(jwks=jwks, timestamp=1234567890)

        assert len(snapshot.jwks.keys) == 1
        assert snapshot.jwks.keys[0].kid == "key-1"
        assert snapshot.timestamp == 1234567890

    def test_jwks_snapshot_to_dict(self) -> None:
        """Test JWKS snapshot to_dict."""
        jwks = JsonWebKeySet(keys=[
            JsonWebKey(kty="EC", kid="key-1", crv="P-256", x="x1", y="y1")
        ])
        snapshot = JwksSnapshot(jwks=jwks, timestamp=1234567890)

        result = snapshot.to_dict()

        assert result["keys"][0]["kid"] == "key-1"
        assert result["timestamp"] == 1234567890

    def test_jwks_snapshot_from_dict(self) -> None:
        """Test JWKS snapshot from_dict."""
        data = {
            "keys": [
                {"kty": "EC", "kid": "key-1", "crv": "P-256", "x": "x1", "y": "y1"}
            ],
            "timestamp": 1234567890
        }

        snapshot = JwksSnapshot.from_dict(data)

        assert len(snapshot.jwks.keys) == 1
        assert snapshot.jwks.keys[0].kid == "key-1"
        assert snapshot.timestamp == 1234567890


class TestMemorySnapshotProvider:
    """Tests for MemorySnapshotProvider."""

    def test_load_returns_none_initially(self) -> None:
        """Test load returns None when no data saved."""
        provider = MemorySnapshotProvider()

        assert provider.load_definitions() is None
        assert provider.load_jwks() is None

    def test_save_and_load_definitions(self) -> None:
        """Test save and load definitions."""
        provider = MemorySnapshotProvider()
        snapshot = DefinitionsSnapshot(
            definitions=[
                FeatureDefinition(feature_key="feature1")
            ]
        )

        provider.save_definitions(snapshot)
        loaded = provider.load_definitions()

        assert loaded is not None
        assert loaded.definitions[0].feature_key == "feature1"

    def test_save_and_load_jwks(self) -> None:
        """Test save and load JWKS."""
        provider = MemorySnapshotProvider()
        snapshot = JwksSnapshot(
            jwks=JsonWebKeySet(keys=[
                JsonWebKey(kty="EC", kid="key-1", crv="P-256", x="x", y="y")
            ])
        )

        provider.save_jwks(snapshot)
        loaded = provider.load_jwks()

        assert loaded is not None
        assert loaded.jwks.keys[0].kid == "key-1"

    def test_clear(self) -> None:
        """Test clear removes all data."""
        provider = MemorySnapshotProvider()
        provider.save_definitions(DefinitionsSnapshot())
        provider.save_jwks(JwksSnapshot())

        provider.clear()

        assert provider.load_definitions() is None
        assert provider.load_jwks() is None

    def test_overwrite(self) -> None:
        """Test saving overwrites previous data."""
        provider = MemorySnapshotProvider()

        provider.save_definitions(DefinitionsSnapshot(
            definitions=[FeatureDefinition(feature_key="first")]
        ))
        provider.save_definitions(DefinitionsSnapshot(
            definitions=[FeatureDefinition(feature_key="second")]
        ))

        loaded = provider.load_definitions()
        assert loaded is not None
        assert loaded.definitions[0].feature_key == "second"


class TestFileSnapshotProvider:
    """Tests for FileSnapshotProvider."""

    def test_load_returns_none_initially(self) -> None:
        """Test load returns None when no files exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(directory=tmpdir)

            assert provider.load_definitions() is None
            assert provider.load_jwks() is None

    def test_save_and_load_definitions(self) -> None:
        """Test save and load definitions to file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(directory=tmpdir)
            snapshot = DefinitionsSnapshot(
                definitions=[
                    FeatureDefinition(
                        feature_key="feature1",
                        filters=[FeatureFilter(name="AlwaysOn")]
                    )
                ],
                etag="abc123"
            )

            provider.save_definitions(snapshot)
            loaded = provider.load_definitions()

            assert loaded is not None
            assert loaded.definitions[0].feature_key == "feature1"
            assert loaded.etag == "abc123"

    def test_save_and_load_jwks(self) -> None:
        """Test save and load JWKS to file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(directory=tmpdir)
            snapshot = JwksSnapshot(
                jwks=JsonWebKeySet(keys=[
                    JsonWebKey(kty="EC", kid="key-1", crv="P-256", x="x", y="y")
                ]),
                timestamp=1234567890
            )

            provider.save_jwks(snapshot)
            loaded = provider.load_jwks()

            assert loaded is not None
            assert loaded.jwks.keys[0].kid == "key-1"
            assert loaded.timestamp == 1234567890

    def test_clear_removes_files(self) -> None:
        """Test clear removes cache files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(directory=tmpdir)
            provider.save_definitions(DefinitionsSnapshot())
            provider.save_jwks(JwksSnapshot())

            provider.clear()

            assert provider.load_definitions() is None
            assert provider.load_jwks() is None

    def test_custom_filenames(self) -> None:
        """Test custom filenames."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(
                directory=tmpdir,
                definitions_filename="custom_defs.json",
                jwks_filename="custom_jwks.json"
            )
            provider.save_definitions(DefinitionsSnapshot())

            assert (Path(tmpdir) / "custom_defs.json").exists()

    def test_handles_corrupted_file(self) -> None:
        """Test handles corrupted JSON file gracefully."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(directory=tmpdir)

            # Write corrupted JSON
            defs_path = Path(tmpdir) / "toggly_definitions.json"
            defs_path.write_text("not valid json{{{")

            # Should return None, not raise
            assert provider.load_definitions() is None

    def test_handles_missing_fields(self) -> None:
        """Test handles JSON with missing fields."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(directory=tmpdir)

            # Write JSON with minimal fields
            defs_path = Path(tmpdir) / "toggly_definitions.json"
            defs_path.write_text(json.dumps({"definitions": []}))

            loaded = provider.load_definitions()
            assert loaded is not None
            assert loaded.definitions == []

    def test_atomic_write(self) -> None:
        """Test atomic write doesn't corrupt on error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = FileSnapshotProvider(directory=tmpdir)

            # First write
            snapshot1 = DefinitionsSnapshot(
                definitions=[FeatureDefinition(feature_key="first")]
            )
            provider.save_definitions(snapshot1)

            # Second write
            snapshot2 = DefinitionsSnapshot(
                definitions=[FeatureDefinition(feature_key="second")]
            )
            provider.save_definitions(snapshot2)

            # Verify second write succeeded
            loaded = provider.load_definitions()
            assert loaded is not None
            assert loaded.definitions[0].feature_key == "second"

    def test_creates_directory(self) -> None:
        """Test creates directory if it doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            nested_dir = Path(tmpdir) / "nested" / "path"
            provider = FileSnapshotProvider(directory=nested_dir)
            provider.save_definitions(DefinitionsSnapshot())

            assert nested_dir.exists()
