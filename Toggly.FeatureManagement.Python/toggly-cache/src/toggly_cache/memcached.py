"""Memcached snapshot provider for Toggly feature flags.

This module provides a Memcached-based snapshot provider for caching
feature flag definitions.

Example:
    from toggly import TogglyClient, TogglyConfig
    from toggly_cache import MemcachedSnapshotProvider

    # Using connection parameters
    provider = MemcachedSnapshotProvider(
        servers=[("localhost", 11211)],
        prefix="toggly:",
    )

    # Or using an existing client
    from pymemcache.client.base import Client
    memcached_client = Client(("localhost", 11211))
    provider = MemcachedSnapshotProvider(client=memcached_client, prefix="toggly:")

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
from typing import TYPE_CHECKING, Any, Sequence

from toggly import FeatureDefinition

if TYPE_CHECKING:
    from pymemcache.client.base import Client

logger = logging.getLogger(__name__)


class MemcachedSnapshotProvider:
    """Memcached-based snapshot provider for feature flag definitions.

    This provider stores feature flag snapshots in Memcached, enabling
    distributed caching across multiple application instances.

    Attributes:
        client: The Memcached client instance.
        prefix: Key prefix for Memcached keys.
        ttl: TTL in seconds for cached data (default: 0 = no expiry).
    """

    def __init__(
        self,
        client: Client | None = None,
        servers: Sequence[tuple[str, int]] | None = None,
        prefix: str = "toggly:",
        ttl: int = 0,
        **memcached_kwargs: Any,
    ) -> None:
        """Initialize the Memcached snapshot provider.

        You can either provide an existing Memcached client or connection
        parameters to create a new one.

        Args:
            client: An existing pymemcache Client instance.
            servers: List of (host, port) tuples for Memcached servers.
                    If only one server, uses Client; otherwise HashClient.
            prefix: Key prefix for all Toggly keys (default: "toggly:").
            ttl: TTL in seconds for cached data (default: 0 = no expiry).
            **memcached_kwargs: Additional arguments passed to Memcached client.

        Raises:
            ImportError: If pymemcache package is not installed.
            ValueError: If neither client nor servers is provided.
        """
        try:
            from pymemcache.client import base as memcache_base
            from pymemcache.client import hash as memcache_hash
        except ImportError as e:
            raise ImportError(
                "pymemcache package is required for MemcachedSnapshotProvider. "
                "Install it with: pip install toggly-cache[memcached]"
            ) from e

        if client is not None:
            self._client = client
        elif servers is not None:
            if len(servers) == 1:
                self._client = memcache_base.Client(
                    servers[0],
                    **memcached_kwargs,
                )
            else:
                self._client = memcache_hash.HashClient(
                    servers,
                    **memcached_kwargs,
                )
        else:
            raise ValueError("Either client or servers must be provided")

        self._prefix = prefix
        self._ttl = ttl

    @property
    def client(self) -> Client:
        """Get the Memcached client instance."""
        return self._client

    def _make_key(self, app_key: str, environment: str) -> str:
        """Generate a Memcached key for the given app and environment.

        Note: Memcached keys cannot contain spaces or control characters,
        and are limited to 250 bytes. This method sanitizes the key.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            The Memcached key string.
        """
        # Replace spaces and special chars that memcached doesn't allow
        safe_app_key = app_key.replace(" ", "_").replace("\n", "_")
        safe_env = environment.replace(" ", "_").replace("\n", "_")
        key = f"{self._prefix}snapshot:{safe_app_key}:{safe_env}"
        # Memcached key limit is 250 bytes
        if len(key.encode("utf-8")) > 250:
            # Use a hash for very long keys
            import hashlib
            key_hash = hashlib.md5(key.encode("utf-8")).hexdigest()
            key = f"{self._prefix}snapshot:{key_hash}"
        return key

    def save(
        self,
        app_key: str,
        environment: str,
        definitions: list[FeatureDefinition],
    ) -> None:
        """Save feature definitions to Memcached.

        Args:
            app_key: The application key.
            environment: The environment name.
            definitions: List of feature definitions to save.
        """
        key = self._make_key(app_key, environment)
        data = json.dumps([d.to_dict() for d in definitions])

        try:
            self._client.set(key, data.encode("utf-8"), expire=self._ttl)
            logger.debug(
                "Saved %d feature definitions to Memcached key: %s",
                len(definitions),
                key,
            )
        except Exception as e:
            logger.error("Failed to save snapshot to Memcached: %s", e)
            raise

    def load(
        self,
        app_key: str,
        environment: str,
    ) -> list[FeatureDefinition] | None:
        """Load feature definitions from Memcached.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            List of feature definitions, or None if not found.
        """
        key = self._make_key(app_key, environment)

        try:
            data = self._client.get(key)
            if data is None:
                logger.debug("No snapshot found in Memcached for key: %s", key)
                return None

            if isinstance(data, bytes):
                data = data.decode("utf-8")

            definitions_data = json.loads(data)
            definitions = [
                FeatureDefinition.from_dict(d) for d in definitions_data
            ]
            logger.debug(
                "Loaded %d feature definitions from Memcached key: %s",
                len(definitions),
                key,
            )
            return definitions
        except json.JSONDecodeError as e:
            logger.error("Failed to parse snapshot from Memcached: %s", e)
            return None
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to load snapshot from Memcached: %s", e)
            return None

    def delete(self, app_key: str, environment: str) -> bool:
        """Delete feature definitions from Memcached.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            True if the key was deleted, False otherwise.
        """
        key = self._make_key(app_key, environment)

        try:
            result = self._client.delete(key)
            # pymemcache returns True if deleted, False if not found
            if result:
                logger.debug("Deleted snapshot from Memcached key: %s", key)
            return bool(result)
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to delete snapshot from Memcached: %s", e)
            return False

    def exists(self, app_key: str, environment: str) -> bool:
        """Check if a snapshot exists in Memcached.

        Args:
            app_key: The application key.
            environment: The environment name.

        Returns:
            True if the snapshot exists.
        """
        key = self._make_key(app_key, environment)

        try:
            # Memcached doesn't have an EXISTS command, so we need to get
            return self._client.get(key) is not None
        except Exception as e:  # noqa: BLE001
            logger.error(
                "Failed to check snapshot existence in Memcached: %s", e
            )
            return False

    def close(self) -> None:
        """Close the Memcached connection.

        Note: This only closes connections created by this provider.
        If you passed an existing client, you are responsible for
        closing it yourself.
        """
        try:
            self._client.close()
        except Exception as e:  # noqa: BLE001
            logger.warning("Error closing Memcached connection: %s", e)
