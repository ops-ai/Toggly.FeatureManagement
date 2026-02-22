"""Redis snapshot provider for Toggly feature flags.

This module provides a Redis-based snapshot provider for caching
feature flag definitions.

Example:
    from toggly import TogglyClient, TogglyConfig
    from toggly_cache import RedisSnapshotProvider

    # Using connection parameters
    provider = RedisSnapshotProvider(
        host="localhost",
        port=6379,
        db=0,
        prefix="toggly:",
    )

    # Or using an existing Redis client
    import redis
    redis_client = redis.Redis(host="localhost", port=6379)
    provider = RedisSnapshotProvider(client=redis_client, prefix="toggly:")

    config = TogglyConfig(
        app_key="your-app-key",
        environment="production",
        snapshot_provider=provider,
    )

    client = TogglyClient(config)
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from toggly import FeatureDefinition

if TYPE_CHECKING:
    from redis import Redis

logger = logging.getLogger(__name__)


class RedisSnapshotProvider:
    """Redis-based snapshot provider for feature flag definitions.

    This provider stores feature flag snapshots in Redis, enabling
    distributed caching across multiple application instances.

    Attributes:
        client: The Redis client instance.
        prefix: Key prefix for Redis keys.
        ttl: Optional TTL in seconds for cached data.
    """

    def __init__(
        self,
        client: "Redis | None" = None,
        host: str = "localhost",
        port: int = 6379,
        db: int = 0,
        password: str | None = None,
        prefix: str = "toggly:",
        ttl: int | None = None,
        **redis_kwargs: Any,
    ) -> None:
        """Initialize the Redis snapshot provider.

        You can either provide an existing Redis client or connection
        parameters to create a new one.

        Args:
            client: An existing Redis client instance.
            host: Redis host (default: localhost).
            port: Redis port (default: 6379).
            db: Redis database number (default: 0).
            password: Redis password (optional).
            prefix: Key prefix for all Toggly keys (default: "toggly:").
            ttl: Optional TTL in seconds for cached data.
            **redis_kwargs: Additional arguments passed to Redis client.

        Raises:
            ImportError: If redis package is not installed.
        """
        try:
            import redis as redis_module
        except ImportError as e:
            raise ImportError(
                "redis package is required for RedisSnapshotProvider. "
                "Install it with: pip install toggly-cache[redis]"
            ) from e

        if client is not None:
            self._client = client
        else:
            self._client = redis_module.Redis(
                host=host,
                port=port,
                db=db,
                password=password,
                **redis_kwargs,
            )

        self._prefix = prefix
        self._ttl = ttl

    @property
    def client(self) -> "Redis":
        """Get the Redis client instance."""
        return self._client

    def _make_key(self, app_key: str, environment: str) -> str:
        """Generate a Redis key for the given app and environment.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            The Redis key string.
        """
        return f"{self._prefix}snapshot:{app_key}:{environment}"

    def save(
        self,
        app_key: str,
        environment: str,
        definitions: list[FeatureDefinition],
    ) -> None:
        """Save feature definitions to Redis.

        Args:
            app_key: The application key.
            environment: The environment name.
            definitions: List of feature definitions to save.
        """
        key = self._make_key(app_key, environment)
        data = json.dumps([d.to_dict() for d in definitions])

        try:
            if self._ttl is not None:
                self._client.setex(key, self._ttl, data)
            else:
                self._client.set(key, data)
            logger.debug(
                "Saved %d feature definitions to Redis key: %s",
                len(definitions),
                key,
            )
        except Exception as e:
            logger.error("Failed to save snapshot to Redis: %s", e)
            raise

    def load(
        self,
        app_key: str,
        environment: str,
    ) -> list[FeatureDefinition] | None:
        """Load feature definitions from Redis.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            List of feature definitions, or None if not found.
        """
        key = self._make_key(app_key, environment)

        try:
            raw: bytes | None = self._client.get(key)  # type: ignore[assignment]
            if raw is None:
                logger.debug("No snapshot found in Redis for key: %s", key)
                return None

            data: str = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)

            definitions_data = json.loads(data)
            definitions = [
                FeatureDefinition.from_dict(d) for d in definitions_data
            ]
            logger.debug(
                "Loaded %d feature definitions from Redis key: %s",
                len(definitions),
                key,
            )
            return definitions
        except json.JSONDecodeError as e:
            logger.error("Failed to parse snapshot from Redis: %s", e)
            return None
        except Exception as e:
            logger.error("Failed to load snapshot from Redis: %s", e)
            return None

    def delete(self, app_key: str, environment: str) -> bool:
        """Delete feature definitions from Redis.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            True if the key was deleted, False otherwise.
        """
        key = self._make_key(app_key, environment)

        try:
            result: int = self._client.delete(key)  # type: ignore[assignment]
            deleted = result > 0
            if deleted:
                logger.debug("Deleted snapshot from Redis key: %s", key)
            return deleted
        except Exception as e:
            logger.error("Failed to delete snapshot from Redis: %s", e)
            return False

    def exists(self, app_key: str, environment: str) -> bool:
        """Check if a snapshot exists in Redis.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            True if the snapshot exists.
        """
        key = self._make_key(app_key, environment)

        try:
            return bool(self._client.exists(key))
        except Exception as e:
            logger.error("Failed to check snapshot existence in Redis: %s", e)
            return False

    def close(self) -> None:
        """Close the Redis connection.

        Note: This only closes connections created by this provider.
        If you passed an existing client, you are responsible for
        closing it yourself.
        """
        try:
            self._client.close()
        except Exception as e:
            logger.warning("Error closing Redis connection: %s", e)
