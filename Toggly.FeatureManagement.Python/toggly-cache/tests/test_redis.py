"""Tests for Redis snapshot provider."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from toggly import FeatureDefinition


class TestRedisSnapshotProvider:
    """Tests for RedisSnapshotProvider."""

    @pytest.fixture
    def mock_redis(self):
        """Create a mock Redis client."""
        return MagicMock()

    @pytest.fixture
    def sample_definitions(self) -> list[FeatureDefinition]:
        """Create sample feature definitions."""
        return [
            FeatureDefinition(
                feature_key="feature-1",
                feature_name="Feature 1",
                is_enabled=True,
            ),
            FeatureDefinition(
                feature_key="feature-2",
                feature_name="Feature 2",
                is_enabled=False,
            ),
        ]

    def test_init_with_client(self, mock_redis):
        """Test initialization with existing client."""
        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis, prefix="test:")
            assert provider.client is mock_redis
            assert provider._prefix == "test:"

    def test_init_with_params(self):
        """Test initialization with connection parameters."""
        mock_redis_module = MagicMock()
        mock_client = MagicMock()
        mock_redis_module.Redis.return_value = mock_client

        with patch.dict("sys.modules", {"redis": mock_redis_module}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(
                host="redis.example.com",
                port=6380,
                db=1,
                password="secret",
                prefix="app:",
            )

            mock_redis_module.Redis.assert_called_once_with(
                host="redis.example.com",
                port=6380,
                db=1,
                password="secret",
            )
            assert provider.client is mock_client

    def test_init_without_redis_raises(self):
        """Test that ImportError is raised if redis is not installed."""
        import sys

        # Temporarily remove redis from modules
        redis_module = sys.modules.pop("redis", None)
        try:
            # Force reimport
            import importlib

            if "toggly_cache.redis" in sys.modules:
                del sys.modules["toggly_cache.redis"]

            with pytest.raises(ImportError, match="redis package is required"):
                from toggly_cache.redis import RedisSnapshotProvider

                RedisSnapshotProvider(host="localhost")
        finally:
            if redis_module:
                sys.modules["redis"] = redis_module

    def test_make_key(self, mock_redis):
        """Test key generation."""
        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis, prefix="toggly:")
            key = provider._make_key("app-123", "production")
            assert key == "toggly:snapshot:app-123:production"

    def test_save(self, mock_redis, sample_definitions):
        """Test saving definitions to Redis."""
        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis, prefix="toggly:")
            provider.save("app-key", "production", sample_definitions)

            mock_redis.set.assert_called_once()
            call_args = mock_redis.set.call_args
            assert call_args[0][0] == "toggly:snapshot:app-key:production"
            # Verify JSON data
            saved_data = json.loads(call_args[0][1])
            assert len(saved_data) == 2
            assert saved_data[0]["featureKey"] == "feature-1"

    def test_save_with_ttl(self, mock_redis, sample_definitions):
        """Test saving with TTL."""
        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(
                client=mock_redis, prefix="toggly:", ttl=3600
            )
            provider.save("app-key", "production", sample_definitions)

            mock_redis.setex.assert_called_once()
            call_args = mock_redis.setex.call_args
            assert call_args[0][0] == "toggly:snapshot:app-key:production"
            assert call_args[0][1] == 3600

    def test_load_success(self, mock_redis):
        """Test loading definitions from Redis."""
        data = json.dumps(
            [
                {"featureKey": "feature-1", "featureName": "Feature 1", "isEnabled": True},
            ]
        )
        mock_redis.get.return_value = data.encode("utf-8")

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            definitions = provider.load("app-key", "production")

            assert definitions is not None
            assert len(definitions) == 1
            assert definitions[0].feature_key == "feature-1"

    def test_load_not_found(self, mock_redis):
        """Test loading when key doesn't exist."""
        mock_redis.get.return_value = None

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            definitions = provider.load("app-key", "production")

            assert definitions is None

    def test_load_invalid_json(self, mock_redis):
        """Test loading with invalid JSON."""
        mock_redis.get.return_value = b"not valid json"

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            definitions = provider.load("app-key", "production")

            assert definitions is None

    def test_delete_success(self, mock_redis):
        """Test deleting from Redis."""
        mock_redis.delete.return_value = 1

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            result = provider.delete("app-key", "production")

            assert result is True
            mock_redis.delete.assert_called_once_with(
                "toggly:snapshot:app-key:production"
            )

    def test_delete_not_found(self, mock_redis):
        """Test deleting non-existent key."""
        mock_redis.delete.return_value = 0

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            result = provider.delete("app-key", "production")

            assert result is False

    def test_exists(self, mock_redis):
        """Test checking if key exists."""
        mock_redis.exists.return_value = 1

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            result = provider.exists("app-key", "production")

            assert result is True

    def test_exists_not_found(self, mock_redis):
        """Test checking if key doesn't exist."""
        mock_redis.exists.return_value = 0

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            result = provider.exists("app-key", "production")

            assert result is False

    def test_close(self, mock_redis):
        """Test closing the connection."""
        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            provider.close()

            mock_redis.close.assert_called_once()

    def test_error_handling_on_save(self, mock_redis, sample_definitions):
        """Test error handling during save."""
        mock_redis.set.side_effect = Exception("Connection error")

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)

            with pytest.raises(Exception, match="Connection error"):
                provider.save("app-key", "production", sample_definitions)

    def test_error_handling_on_load(self, mock_redis):
        """Test error handling during load."""
        mock_redis.get.side_effect = Exception("Connection error")

        with patch.dict("sys.modules", {"redis": MagicMock()}):
            from toggly_cache.redis import RedisSnapshotProvider

            provider = RedisSnapshotProvider(client=mock_redis)
            result = provider.load("app-key", "production")

            assert result is None
