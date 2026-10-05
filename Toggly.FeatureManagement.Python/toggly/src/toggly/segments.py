"""Backend-key client for targeting-list membership."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import quote


class SegmentMembershipClient:
    """Add, remove, or replace identifiers on existing Toggly segments."""

    def __init__(
        self, app_key: str, app_base_url: str = "https://app.toggly.io"
    ) -> None:
        """Create a client authenticated with a Backend application key."""
        if not app_key:
            raise ValueError("app_key is required")
        self._app_key = app_key
        self._base = app_base_url.rstrip("/")

    def list_segments(self) -> Any:
        """List targeting lists visible to the Backend application key."""
        return self._request("GET", "/api/v2/segments")

    def add_segment_members(self, segment: str, identifiers: list[str]) -> Any:
        """Add identifiers to an existing targeting list."""
        path = f"/api/v2/segments/{quote(segment, safe='')}/items"
        return self._request("POST", path, {"identifiers": identifiers})

    def remove_segment_members(self, segment: str, identifiers: list[str]) -> Any:
        """Remove identifiers from an existing targeting list."""
        path = f"/api/v2/segments/{quote(segment, safe='')}/items"
        return self._request("DELETE", path, {"identifiers": identifiers})

    def replace_segment_members(self, segment: str, identifiers: list[str]) -> Any:
        """Replace all identifiers on an existing targeting list."""
        path = f"/api/v2/segments/{quote(segment, safe='')}/items"
        return self._request("PUT", path, {"identifiers": identifiers})

    def _request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {
            "Authorization": self._app_key,
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self._base + path,
            data=data,
            method=method,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read().decode("utf-8")
                # Mutations may return 204/empty bodies; skip JSON parse.
                if not payload.strip():
                    return None
                return json.loads(payload)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(
                f"Segment membership {method} {path} failed: {exc.code}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"Segment membership {method} {path} failed: {exc.reason}"
            ) from exc
