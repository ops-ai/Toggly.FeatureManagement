"""Shared test helpers for toggly-fastapi."""

from fastapi import FastAPI


def create_test_app() -> FastAPI:
    """Create a FastAPI app without trailing-slash redirects for TestClient."""
    return FastAPI(redirect_slashes=False)


def set_middleware_client(client) -> None:
    """Pin the middleware module client so integration tests never hit the network."""
    import toggly_fastapi.middleware as middleware_mod

    middleware_mod._client = client
