"""Snapshot providers for caching feature definitions."""

from __future__ import annotations

import json
import os
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any

from toggly.models import FeatureDefinition, FeatureFilter, JsonWebKey, JsonWebKeySet


@dataclass
class DefinitionsSnapshot:
    """Snapshot of feature definitions for caching."""

    definitions: list[FeatureDefinition] = field(default_factory=list)
    """List of feature definitions."""

    signature: str | None = None
    """Signature if using signed definitions."""

    key_id: str | None = None
    """Signing key ID."""

    timestamp: int | None = None
    """Unix timestamp when snapshot was created."""

    etag: str | None = None
    """ETag for cache validation."""

    def to_dict(self) -> dict[str, Any]:
        """Convert snapshot to a dictionary for serialization.

        Returns:
            Dictionary representation of the snapshot.
        """
        return {
            "definitions": [
                {
                    "feature_key": d.feature_key,
                    "filters": [
                        {"name": f.name, "parameters": f.parameters} for f in d.filters
                    ],
                    "requirement_type": d.requirement_type,
                    "secured_feature": d.secured_feature,
                    "metrics": d.metrics,
                }
                for d in self.definitions
            ],
            "signature": self.signature,
            "key_id": self.key_id,
            "timestamp": self.timestamp,
            "etag": self.etag,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DefinitionsSnapshot:
        """Create a snapshot from a dictionary.

        Args:
            data: Dictionary with snapshot data.

        Returns:
            A DefinitionsSnapshot instance.
        """
        definitions = []
        for d in data.get("definitions", []):
            filters = [
                FeatureFilter(name=f["name"], parameters=f.get("parameters", {}))
                for f in d.get("filters", [])
            ]
            definitions.append(
                FeatureDefinition(
                    feature_key=d["feature_key"],
                    filters=filters,
                    requirement_type=d.get("requirement_type", "Any"),
                    secured_feature=d.get("secured_feature", False),
                    metrics=d.get("metrics"),
                )
            )
        return cls(
            definitions=definitions,
            signature=data.get("signature"),
            key_id=data.get("key_id"),
            timestamp=data.get("timestamp"),
            etag=data.get("etag"),
        )


@dataclass
class JwksSnapshot:
    """Snapshot of JSON Web Key Set for caching."""

    jwks: JsonWebKeySet = field(default_factory=JsonWebKeySet)
    """The JSON Web Key Set."""

    timestamp: int | None = None
    """Unix timestamp when snapshot was created."""

    def to_dict(self) -> dict[str, Any]:
        """Convert snapshot to a dictionary for serialization.

        Returns:
            Dictionary representation of the snapshot.
        """
        return {
            "keys": [
                {
                    "kty": k.kty,
                    "kid": k.kid,
                    "crv": k.crv,
                    "x": k.x,
                    "y": k.y,
                    "alg": k.alg,
                    "use": k.use,
                }
                for k in self.jwks.keys
            ],
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> JwksSnapshot:
        """Create a snapshot from a dictionary.

        Args:
            data: Dictionary with snapshot data.

        Returns:
            A JwksSnapshot instance.
        """
        keys = [
            JsonWebKey(
                kty=k["kty"],
                kid=k["kid"],
                crv=k["crv"],
                x=k["x"],
                y=k["y"],
                alg=k.get("alg", "ES256"),
                use=k.get("use", "sig"),
            )
            for k in data.get("keys", [])
        ]
        return cls(
            jwks=JsonWebKeySet(keys=keys),
            timestamp=data.get("timestamp"),
        )


class SnapshotProvider(ABC):
    """Abstract base class for snapshot providers.

    Snapshot providers are responsible for caching feature definitions
    and JWKS locally to support offline operation and faster startup.
    """

    @abstractmethod
    def load_definitions(self) -> DefinitionsSnapshot | None:
        """Load cached feature definitions.

        Returns:
            The cached definitions snapshot, or None if not available.
        """
        pass

    @abstractmethod
    def save_definitions(self, snapshot: DefinitionsSnapshot) -> None:
        """Save feature definitions to cache.

        Args:
            snapshot: The definitions snapshot to save.
        """
        pass

    @abstractmethod
    def load_jwks(self) -> JwksSnapshot | None:
        """Load cached JSON Web Key Set.

        Returns:
            The cached JWKS snapshot, or None if not available.
        """
        pass

    @abstractmethod
    def save_jwks(self, snapshot: JwksSnapshot) -> None:
        """Save JSON Web Key Set to cache.

        Args:
            snapshot: The JWKS snapshot to save.
        """
        pass

    def clear(self) -> None:
        """Clear all cached data.

        Default implementation does nothing. Override if needed.
        """
        pass


class MemorySnapshotProvider(SnapshotProvider):
    """In-memory snapshot provider.

    Useful for testing or when persistence is not needed.
    """

    def __init__(self) -> None:
        """Initialize the memory snapshot provider."""
        self._definitions: DefinitionsSnapshot | None = None
        self._jwks: JwksSnapshot | None = None
        self._lock = RLock()

    def load_definitions(self) -> DefinitionsSnapshot | None:
        """Load cached feature definitions from memory.

        Returns:
            The cached definitions snapshot, or None if not available.
        """
        with self._lock:
            return self._definitions

    def save_definitions(self, snapshot: DefinitionsSnapshot) -> None:
        """Save feature definitions to memory.

        Args:
            snapshot: The definitions snapshot to save.
        """
        with self._lock:
            self._definitions = snapshot

    def load_jwks(self) -> JwksSnapshot | None:
        """Load cached JSON Web Key Set from memory.

        Returns:
            The cached JWKS snapshot, or None if not available.
        """
        with self._lock:
            return self._jwks

    def save_jwks(self, snapshot: JwksSnapshot) -> None:
        """Save JSON Web Key Set to memory.

        Args:
            snapshot: The JWKS snapshot to save.
        """
        with self._lock:
            self._jwks = snapshot

    def clear(self) -> None:
        """Clear all cached data."""
        with self._lock:
            self._definitions = None
            self._jwks = None


class FileSnapshotProvider(SnapshotProvider):
    """File-based snapshot provider.

    Stores definitions and JWKS as JSON files on disk.
    Uses atomic writes (temp file + rename) for data safety.
    """

    def __init__(
        self,
        directory: str | Path | None = None,
        definitions_filename: str = "toggly_definitions.json",
        jwks_filename: str = "toggly_jwks.json",
    ) -> None:
        """Initialize the file snapshot provider.

        Args:
            directory: Directory for storing snapshot files.
                      Defaults to system temp directory.
            definitions_filename: Filename for definitions snapshot.
            jwks_filename: Filename for JWKS snapshot.
        """
        if directory is None:
            directory = Path(tempfile.gettempdir()) / "toggly"
        self._directory = Path(directory)
        self._definitions_path = self._directory / definitions_filename
        self._jwks_path = self._directory / jwks_filename
        self._lock = RLock()

        # Ensure directory exists
        self._directory.mkdir(parents=True, exist_ok=True)

    def load_definitions(self) -> DefinitionsSnapshot | None:
        """Load cached feature definitions from file.

        Returns:
            The cached definitions snapshot, or None if not available.
        """
        with self._lock:
            return self._load_json(self._definitions_path, DefinitionsSnapshot.from_dict)

    def save_definitions(self, snapshot: DefinitionsSnapshot) -> None:
        """Save feature definitions to file using atomic write.

        Args:
            snapshot: The definitions snapshot to save.
        """
        with self._lock:
            self._save_json(self._definitions_path, snapshot.to_dict())

    def load_jwks(self) -> JwksSnapshot | None:
        """Load cached JSON Web Key Set from file.

        Returns:
            The cached JWKS snapshot, or None if not available.
        """
        with self._lock:
            return self._load_json(self._jwks_path, JwksSnapshot.from_dict)

    def save_jwks(self, snapshot: JwksSnapshot) -> None:
        """Save JSON Web Key Set to file using atomic write.

        Args:
            snapshot: The JWKS snapshot to save.
        """
        with self._lock:
            self._save_json(self._jwks_path, snapshot.to_dict())

    def clear(self) -> None:
        """Clear all cached files."""
        with self._lock:
            for path in [self._definitions_path, self._jwks_path]:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _load_json(
        self,
        path: Path,
        parser: Any,
    ) -> Any:
        """Load and parse a JSON file.

        Args:
            path: Path to the JSON file.
            parser: Function to parse the loaded dictionary.

        Returns:
            Parsed object or None if file doesn't exist.
        """
        try:
            if not path.exists():
                return None
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return parser(data)
        except (OSError, json.JSONDecodeError, KeyError, TypeError):
            return None

    def _save_json(self, path: Path, data: dict[str, Any]) -> None:
        """Save data to a JSON file using atomic write.

        Args:
            path: Path to the JSON file.
            data: Data to save.
        """
        try:
            # Write to temp file first
            fd, temp_path = tempfile.mkstemp(
                dir=self._directory,
                prefix=".toggly_",
                suffix=".tmp",
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                # Atomic rename
                os.replace(temp_path, path)
            except Exception:
                # Clean up temp file on error
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
                raise
        except OSError:
            pass  # Silently fail - caching is best-effort
