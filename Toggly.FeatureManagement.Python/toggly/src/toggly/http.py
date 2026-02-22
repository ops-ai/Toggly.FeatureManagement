"""HTTP client for Toggly API communication.

This module uses only standard library (urllib) to maintain zero dependencies.
"""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

from toggly.exceptions import TogglyNetworkError, TogglyTimeoutError


@dataclass
class HttpResponse:
    """HTTP response wrapper."""

    status_code: int
    """HTTP status code."""

    data: bytes
    """Response body."""

    headers: dict[str, str]
    """Response headers."""

    def json(self) -> Any:
        """Parse response body as JSON.

        Returns:
            Parsed JSON data.

        Raises:
            json.JSONDecodeError: If body is not valid JSON.

        """
        return json.loads(self.data.decode("utf-8"))

    def text(self) -> str:
        """Get response body as text.

        Returns:
            Response body as string.

        """
        return self.data.decode("utf-8")


class HttpClient:
    """Simple HTTP client using urllib (zero dependencies).

    Provides basic HTTP functionality for fetching feature definitions.
    """

    def __init__(
        self,
        connect_timeout: float = 10.0,
        request_timeout: float = 30.0,
        user_agent: str = "toggly-python/0.1.0",
    ) -> None:
        """Initialize the HTTP client.

        Args:
            connect_timeout: Connection timeout in seconds.
            request_timeout: Request timeout in seconds.
            user_agent: User-Agent header value.

        """
        self._connect_timeout = connect_timeout
        self._request_timeout = request_timeout
        self._user_agent = user_agent

        # Create SSL context
        self._ssl_context = ssl.create_default_context()

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
    ) -> HttpResponse:
        """Make a GET request.

        Args:
            url: The URL to request.
            headers: Optional request headers.

        Returns:
            The HTTP response.

        Raises:
            TogglyNetworkError: If the request fails.
            TogglyTimeoutError: If the request times out.

        """
        return self._request("GET", url, headers=headers)

    def post(
        self,
        url: str,
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> HttpResponse:
        """Make a POST request.

        Args:
            url: The URL to request.
            data: JSON data to send in the body.
            headers: Optional request headers.

        Returns:
            The HTTP response.

        Raises:
            TogglyNetworkError: If the request fails.
            TogglyTimeoutError: If the request times out.

        """
        body = json.dumps(data).encode("utf-8") if data else None
        request_headers = {"Content-Type": "application/json"}
        if headers:
            request_headers.update(headers)
        return self._request("POST", url, body=body, headers=request_headers)

    def _request(
        self,
        method: str,
        url: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> HttpResponse:
        """Make an HTTP request.

        Args:
            method: HTTP method (GET, POST, etc.).
            url: The URL to request.
            body: Request body (for POST).
            headers: Request headers.

        Returns:
            The HTTP response.

        Raises:
            TogglyNetworkError: If the request fails.
            TogglyTimeoutError: If the request times out.

        """
        request_headers = {
            "User-Agent": self._user_agent,
            "Accept": "application/json",
        }
        if headers:
            request_headers.update(headers)

        request = urllib.request.Request(
            url,
            data=body,
            headers=request_headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=self._request_timeout,
                context=self._ssl_context,
            ) as response:
                return HttpResponse(
                    status_code=response.status,
                    data=response.read(),
                    headers=dict(response.headers),
                )
        except urllib.error.HTTPError as e:
            # HTTP error (4xx, 5xx)
            return HttpResponse(
                status_code=e.code,
                data=e.read() if e.fp else b"",
                headers=dict(e.headers) if e.headers else {},
            )
        except urllib.error.URLError as e:
            if "timed out" in str(e.reason).lower():
                raise TogglyTimeoutError(
                    f"Request timed out: {url}",
                    cause=e,
                ) from e
            raise TogglyNetworkError(
                f"Network error: {e.reason}",
                cause=e,
            ) from e
        except TimeoutError as e:
            raise TogglyTimeoutError(
                f"Request timed out: {url}",
                cause=e,
            ) from e
        except Exception as e:
            raise TogglyNetworkError(
                f"Request failed: {e}",
                cause=e,
            ) from e


def build_definitions_url(
    base_url: str,
    app_key: str,
    environment: str,
    use_signed: bool = False,
    identity: str | None = None,
) -> str:
    """Build the URL for fetching feature definitions.

    Args:
        base_url: Base API URL.
        app_key: Application key.
        environment: Environment name.
        use_signed: Whether to use signed definitions endpoint.
        identity: Optional user identity.

    Returns:
        The full URL for fetching definitions.

    """
    if use_signed:
        path = f"/definitions/v2/{app_key}/{environment}"
    else:
        path = f"/definitions/{app_key}/{environment}"

    if identity:
        path = f"{path}?identity={urllib.parse.quote(identity)}"

    return urljoin(base_url + "/", path.lstrip("/"))


def build_jwks_url(base_url: str) -> str:
    """Build the URL for fetching JWKS.

    Args:
        base_url: Base API URL.

    Returns:
        The full URL for fetching JWKS.

    """
    return urljoin(base_url + "/", ".well-known/jwks")
