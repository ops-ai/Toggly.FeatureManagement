"""Shared test helpers for toggly-fastapi."""


def set_middleware_client(client) -> None:
    """Pin the middleware module client so integration tests never hit the network."""
    import toggly_fastapi.middleware as middleware_mod

    middleware_mod._client = client
