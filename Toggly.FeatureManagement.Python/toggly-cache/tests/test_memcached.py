"""Tests for Memcached snapshot provider."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from toggly import FeatureDefinition


class TestMemcachedSnapshotProvider:
    """Tests for MemcachedSnapshotProvider."""

    @pytest.fixture
    def mock_memcached(self):
        """Create a mock Memcached client."""
        return MagicMock()

    @pytest.fixture
    def mock_pymemcache(self):
        """Create mock pymemcache module."""
        mock_module = MagicMock()
        mock_module.client.base.Client = MagicMock()
        mock_module.client.hash.HashClient = MagicMock()
        return mock_module

    @pytest.fixture
    def sample_definitions(self) -> list[FeatureDefinition]:
        """Create sample feature definitions."""
        return [
            FeatureDefinition(feature_key="feature-1"),
            FeatureDefinition(feature_key="feature-2"),
        ]

    def test_init_with_client(self, mock_memcached, mock_pymemcache):
        """Test initialization with existing client."""
        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(
                client=mock_memcached, prefix="test:"
            )
            assert provider.client is mock_memcached
            assert provider._prefix == "test:"

    def test_init_with_single_server(self, mock_pymemcache):
        """Test initialization with single server."""
        mock_client = MagicMock()
        mock_pymemcache.client.base.Client.return_value = mock_client

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(
                servers=[("localhost", 11211)], prefix="app:"
            )

            mock_pymemcache.client.base.Client.assert_called_once_with(
                ("localhost", 11211),
            )
            assert provider.client is mock_client

    def test_init_with_multiple_servers(self, mock_pymemcache):
        """Test initialization with multiple servers uses HashClient."""
        mock_hash_client = MagicMock()
        mock_pymemcache.client.hash.HashClient.return_value = mock_hash_client

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            servers = [
                ("memcached-1", 11211),
                ("memcached-2", 11211),
            ]
            provider = MemcachedSnapshotProvider(servers=servers)

            mock_pymemcache.client.hash.HashClient.assert_called_once_with(
                servers,
            )
            assert provider.client is mock_hash_client

    def test_init_without_client_or_servers_raises(self, mock_pymemcache):
        """Test that ValueError is raised if neither client nor servers is provided."""
        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            with pytest.raises(
                ValueError, match="Either client or servers must be provided"
            ):
                MemcachedSnapshotProvider()

    def test_init_without_pymemcache_raises(self):
        """Test that ImportError is raised if pymemcache is not installed."""
        import sys

        saved = {
            k: sys.modules.pop(k)
            for k in list(sys.modules)
            if k.startswith("pymemcache") or k == "toggly_cache.memcached"
            if k in sys.modules
        }
        try:
            blocked = {
                k: None
                for k in list(saved) if k.startswith("pymemcache")
            }
            blocked["pymemcache"] = None
            with patch.dict("sys.modules", blocked):
                if "toggly_cache.memcached" in sys.modules:
                    del sys.modules["toggly_cache.memcached"]

                from toggly_cache.memcached import MemcachedSnapshotProvider

                with pytest.raises(
                    ImportError, match="pymemcache package is required"
                ):
                    MemcachedSnapshotProvider(servers=[("localhost", 11211)])
        finally:
            sys.modules.update(saved)

    def test_make_key(self, mock_memcached, mock_pymemcache):
        """Test key generation."""
        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(
                client=mock_memcached, prefix="toggly:"
            )
            key = provider._make_key("app-123", "production")
            assert key == "toggly:snapshot:app-123:production"

    def test_make_key_sanitizes_spaces(self, mock_memcached, mock_pymemcache):
        """Test key sanitizes spaces and special characters."""
        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(
                client=mock_memcached, prefix="toggly:"
            )
            key = provider._make_key("app with spaces", "test\nenv")
            assert " " not in key
            assert "\n" not in key

    def test_save(
        self, mock_memcached, mock_pymemcache, sample_definitions
    ):
        """Test saving definitions to Memcached."""
        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(
                client=mock_memcached, prefix="toggly:", ttl=3600
            )
            provider.save("app-key", "production", sample_definitions)

            mock_memcached.set.assert_called_once()
            call_args = mock_memcached.set.call_args
            assert call_args[0][0] == "toggly:snapshot:app-key:production"
            assert call_args[1]["expire"] == 3600

            # Verify JSON data
            saved_data = json.loads(call_args[0][1].decode("utf-8"))
            assert len(saved_data) == 2
            assert saved_data[0]["feature_key"] == "feature-1"

    def test_load_success(self, mock_memcached, mock_pymemcache):
        """Test loading definitions from Memcached."""
        data = json.dumps(
            [
                {
                    "feature_key": "feature-1",
                    "filters": [],
                    "requirement_type": "Any",
                },
            ]
        )
        mock_memcached.get.return_value = data.encode("utf-8")

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            definitions = provider.load("app-key", "production")

            assert definitions is not None
            assert len(definitions) == 1
            assert definitions[0].feature_key == "feature-1"

    def test_load_not_found(self, mock_memcached, mock_pymemcache):
        """Test loading when key doesn't exist."""
        mock_memcached.get.return_value = None

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            definitions = provider.load("app-key", "production")

            assert definitions is None

    def test_load_invalid_json(self, mock_memcached, mock_pymemcache):
        """Test loading with invalid JSON."""
        mock_memcached.get.return_value = b"not valid json"

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            definitions = provider.load("app-key", "production")

            assert definitions is None

    def test_delete_success(self, mock_memcached, mock_pymemcache):
        """Test deleting from Memcached."""
        mock_memcached.delete.return_value = True

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            result = provider.delete("app-key", "production")

            assert result is True
            mock_memcached.delete.assert_called_once_with(
                "toggly:snapshot:app-key:production"
            )

    def test_delete_not_found(self, mock_memcached, mock_pymemcache):
        """Test deleting non-existent key."""
        mock_memcached.delete.return_value = False

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            result = provider.delete("app-key", "production")

            assert result is False

    def test_exists(self, mock_memcached, mock_pymemcache):
        """Test checking if key exists."""
        mock_memcached.get.return_value = b"data"

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            result = provider.exists("app-key", "production")

            assert result is True

    def test_exists_not_found(self, mock_memcached, mock_pymemcache):
        """Test checking if key doesn't exist."""
        mock_memcached.get.return_value = None

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            result = provider.exists("app-key", "production")

            assert result is False

    def test_close(self, mock_memcached, mock_pymemcache):
        """Test closing the connection."""
        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            provider.close()

            mock_memcached.close.assert_called_once()

    def test_error_handling_on_save(
        self, mock_memcached, mock_pymemcache, sample_definitions
    ):
        """Test error handling during save."""
        mock_memcached.set.side_effect = Exception("Connection error")

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)

            with pytest.raises(Exception, match="Connection error"):
                provider.save("app-key", "production", sample_definitions)

    def test_error_handling_on_load(self, mock_memcached, mock_pymemcache):
        """Test error handling during load."""
        mock_memcached.get.side_effect = Exception("Connection error")

        with patch.dict(
            "sys.modules",
            {
                "pymemcache": mock_pymemcache,
                "pymemcache.client": mock_pymemcache.client,
                "pymemcache.client.base": mock_pymemcache.client.base,
                "pymemcache.client.hash": mock_pymemcache.client.hash,
            },
        ):
            from toggly_cache.memcached import MemcachedSnapshotProvider

            provider = MemcachedSnapshotProvider(client=mock_memcached)
            result = provider.load("app-key", "production")

            assert result is None
