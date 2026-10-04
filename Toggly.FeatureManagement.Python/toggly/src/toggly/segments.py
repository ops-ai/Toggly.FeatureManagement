"""Backend-key client for targeting-list membership."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import quote


class SegmentMembershipClient:
    """Add, remove, or replace identifiers on existing Toggly segments."""

    def __init__(self, app_key: str, app_base_url: str = "https://app.toggly.io") -> None:
        if not app_key:
            raise ValueError("app_key is required")
        self._app_key = app_key
        self._base = app_base_url.rstrip("/")

    def list_segments(self) -> Any:
        return self._request("GET", "/api/v2/segments")

    def add_segment_members(self, segment: str, identifiers: list[str]) -> Any:
        return self._request("POST", f"/api/v2/segments/{quote(segment, safe='')}/items", {"identifiers": identifiers})

    def remove_segment_members(self, segment: str, identifiers: list[str]) -> Any:
        return self._request("DELETE", f"/api/v2/segments/{quote(segment, safe='')}/items", {"identifiers": identifiers})

    def replace_segment_members(self, segment: str, identifiers: list[str]) -> Any:
        return self._request("PUT", f"/api/v2/segments/{quote(segment, safe='')}/items", {"identifiers": identifiers})

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self._base + path,
            data=data,
            method=method,
            headers={"Authorization": self._app_key, "Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Segment membership {method} {path} failed: {exc.code}") from exc
