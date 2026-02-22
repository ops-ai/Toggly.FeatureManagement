"""Exceptions for Toggly SDK."""

from __future__ import annotations


class TogglyError(Exception):
    """Base exception for all Toggly errors."""

    def __init__(self, message: str, cause: Exception | None = None) -> None:
        """Initialize TogglyError.

        Args:
            message: Error message describing what went wrong.
            cause: Optional underlying exception that caused this error.

        """
        super().__init__(message)
        self.message = message
        self.cause = cause

    def __str__(self) -> str:
        """Return string representation of the error."""
        if self.cause:
            return f"{self.message}: {self.cause}"
        return self.message


class TogglyConfigError(TogglyError):
    """Exception raised for configuration errors."""

    pass


class TogglyEvaluationError(TogglyError):
    """Exception raised during feature flag evaluation."""

    pass


class TogglyNetworkError(TogglyError):
    """Exception raised for network-related errors."""

    def __init__(
        self,
        message: str,
        cause: Exception | None = None,
        status_code: int | None = None,
    ) -> None:
        """Initialize TogglyNetworkError.

        Args:
            message: Error message describing the network issue.
            cause: Optional underlying exception.
            status_code: HTTP status code if applicable.

        """
        super().__init__(message, cause)
        self.status_code = status_code


class TogglySignatureError(TogglyError):
    """Exception raised when signature verification fails."""

    pass


class TogglyTimeoutError(TogglyNetworkError):
    """Exception raised when a request times out."""

    pass
