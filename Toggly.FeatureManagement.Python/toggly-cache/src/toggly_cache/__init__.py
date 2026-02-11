"""Toggly Cache - Caching providers for Toggly feature flag management.

This package provides Redis and Memcached snapshot providers for
caching feature flag definitions with Toggly.

Example usage with Redis:
    from toggly import TogglyClient, TogglyConfig
    from toggly_cache import RedisSnapshotProvider

    provider = RedisSnapshotProvider(
        host="localhost",
        port=6379,
        prefix="toggly:",
    )

    config = TogglyConfig(
        app_key="your-app-key",
        environment="production",
        snapshot_provider=provider,
    )

    client = TogglyClient(config)

Example usage with Memcached:
    from toggly import TogglyClient, TogglyConfig
    from toggly_cache import MemcachedSnapshotProvider

    provider = MemcachedSnapshotProvider(
        servers=[("localhost", 11211)],
        prefix="toggly:",
    )

    config = TogglyConfig(
        app_key="your-app-key",
        environment="production",
        snapshot_provider=provider,
    )

    client = TogglyClient(config)
"""

from __future__ import annotations

__version__ = "0.1.0"

# Lazy imports to avoid requiring both redis and pymemcache
def __getattr__(name: str):
    """Lazy import cache providers."""
    if name == "RedisSnapshotProvider":
        from toggly_cache.redis import RedisSnapshotProvider
        return RedisSnapshotProvider
    elif name == "MemcachedSnapshotProvider":
        from toggly_cache.memcached import MemcachedSnapshotProvider
        return MemcachedSnapshotProvider
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "__version__",
    "RedisSnapshotProvider",
    "MemcachedSnapshotProvider",
]
