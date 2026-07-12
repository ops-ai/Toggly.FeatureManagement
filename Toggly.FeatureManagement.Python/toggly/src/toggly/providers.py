"""Snapshot providers for caching feature definitions."""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Any

from toggly.models import (
    EvaluatedVariantDef,
    FeatureDefinition,
    JsonWebKey,
    JsonWebKeySet,
)


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
    """Unix timestamp when snapshot was created / signed."""

    etag: str | None = None
    """ETag for cache validation."""

    signed_defs_json: str | None = None
    """Exact JSON text of the signed ``defs`` array from the server.

    Required for cryptographic verification after a storage round-trip
    (never re-serialize models for verify).
    """

    def to_dict(self) -> dict[str, Any]:
        """Convert snapshot to a dictionary for serialization.

        Returns:
            Dictionary representation of the snapshot.

        """
        return {
            "definitions": [d.to_dict() for d in self.definitions],
            "signature": self.signature,
            "key_id": self.key_id,
            "timestamp": self.timestamp,
            "etag": self.etag,
            "signed_defs_json": self.signed_defs_json,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DefinitionsSnapshot:
        """Create a snapshot from a dictionary.

        Args:
            data: Dictionary with snapshot data.

        Returns:
            A DefinitionsSnapshot instance.

        """
        definitions = [
            FeatureDefinition.from_dict(d) for d in data.get("definitions", [])
        ]
        return cls(
            definitions=definitions,
            signature=data.get("signature"),
            key_id=data.get("key_id") or data.get("kid"),
            timestamp=data.get("timestamp"),
            etag=data.get("etag"),
            signed_defs_json=data.get("signed_defs_json") or data.get("raw_defs"),
        )

    def has_signature_metadata(self) -> bool:
        """Return True when fields needed for re-verification are present."""
        return bool(
            self.signature
            and self.key_id
            and self.timestamp is not None
            and self.signed_defs_json is not None
        )


@dataclass
class VariantsSnapshot:
    """Snapshot of server-evaluated feature variants for caching."""

    defs: dict[str, EvaluatedVariantDef] = field(default_factory=dict)
    """Per-feature evaluated variant definitions."""

    signature: str | None = None
    """Response signature when using signed variants."""

    key_id: str | None = None
    """Signing key id (``kid`` from API)."""

    timestamp: int | None = None
    """Unix timestamp from the signed response."""

    etag: str | None = None
    """ETag for conditional GET."""

    def to_dict(self) -> dict[str, Any]:
        """Convert snapshot to a dictionary for serialization."""
        return {
            "defs": {k: v.to_dict() for k, v in self.defs.items()},
            "signature": self.signature,
            "key_id": self.key_id,
            "timestamp": self.timestamp,
            "etag": self.etag,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> VariantsSnapshot:
        """Create a snapshot from a dictionary."""
        raw = data.get("defs") or {}
        defs: dict[str, EvaluatedVariantDef] = {}
        if isinstance(raw, dict):
            for key, value in raw.items():
                if isinstance(value, dict):
                    defs[key] = EvaluatedVariantDef.from_dict(value)
        return cls(
            defs=defs,
            signature=data.get("signature"),
            key_id=data.get("key_id") or data.get("kid"),
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

    def clear(self) -> None:  # noqa: B027
        """Clear all cached data.

        Default implementation does nothing. Override if needed.
        """
        pass

    def clear_jwks(self) -> None:  # noqa: B027
        """Clear cached JWKS only.

        Default clears via ``clear()`` subclasses should override when they
        can drop JWKS independently of definitions.
        """
        pass

    def load_variants(self) -> VariantsSnapshot | None:
        """Load cached evaluated variants.

        Returns:
            Cached variants snapshot, or None if not available.

        """
        return None

    def save_variants(self, snapshot: VariantsSnapshot) -> None:  # noqa: B027
        """Persist evaluated variants snapshot.

        Default implementation does nothing.

        Args:
            snapshot: Variants snapshot to save.

        """
        pass


class MemorySnapshotProvider(SnapshotProvider):
    """In-memory snapshot provider.

    Useful for testing or when persistence is not needed.
    """

    def __init__(self) -> None:
        """Initialize the memory snapshot provider."""
        self._definitions: DefinitionsSnapshot | None = None
        self._variants: VariantsSnapshot | None = None
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

    def load_variants(self) -> VariantsSnapshot | None:
        """Load cached evaluated variants from memory."""
        with self._lock:
            return self._variants

    def save_variants(self, snapshot: VariantsSnapshot) -> None:
        """Save evaluated variants to memory."""
        with self._lock:
            self._variants = snapshot

    def clear(self) -> None:
        """Clear all cached data."""
        with self._lock:
            self._definitions = None
            self._variants = None
            self._jwks = None

    def clear_jwks(self) -> None:
        """Clear cached JWKS only."""
        with self._lock:
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
        variants_filename: str = "toggly_variants.json",
        jwks_filename: str = "toggly_jwks.json",
    ) -> None:
        """Initialize the file snapshot provider.

        Args:
            directory: Directory for storing snapshot files.
                      Defaults to system temp directory.
            definitions_filename: Filename for definitions snapshot.
            variants_filename: Filename for evaluated variants snapshot.
            jwks_filename: Filename for JWKS snapshot.

        """
        if directory is None:
            directory = Path(tempfile.gettempdir()) / "toggly"
        self._directory = Path(directory)
        self._definitions_path = self._directory / definitions_filename
        self._variants_path = self._directory / variants_filename
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

    def load_variants(self) -> VariantsSnapshot | None:
        """Load cached evaluated variants from file."""
        with self._lock:
            return self._load_json(self._variants_path, VariantsSnapshot.from_dict)

    def save_variants(self, snapshot: VariantsSnapshot) -> None:
        """Save evaluated variants to file using atomic write."""
        with self._lock:
            self._save_json(self._variants_path, snapshot.to_dict())

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
            for path in [self._definitions_path, self._variants_path, self._jwks_path]:
                with contextlib.suppress(OSError):
                    path.unlink(missing_ok=True)

    def clear_jwks(self) -> None:
        """Clear cached JWKS file only."""
        with self._lock, contextlib.suppress(OSError):
            self._jwks_path.unlink(missing_ok=True)

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
            with open(path, encoding="utf-8") as f:
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
                with contextlib.suppress(OSError):
                    os.unlink(temp_path)
                raise
        except OSError:
            pass  # Silently fail - caching is best-effort
