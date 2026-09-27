package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	definitionsSnapshotFile = "definitions.json"
	jwksSnapshotFile        = "jwks.json"
)

// FileProvider stores snapshots as JSON files.
//
// Files:
// - definitions.json
// - jwks.json
//
// NOTE: This is intentionally simple; callers can wrap it with locking if needed.
type FileProvider struct {
	dir string
}

func NewFileProvider(dir string) *FileProvider { return &FileProvider{dir: dir} }

func (f *FileProvider) LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error) {
	_ = ctx
	b, err := os.ReadFile(filepath.Join(f.dir, definitionsSnapshotFile))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var snap DefinitionsSnapshot
	if err := json.Unmarshal(b, &snap); err != nil {
		return nil, fmt.Errorf("decode definitions snapshot: %w", err)
	}
	return &snap, nil
}

func (f *FileProvider) SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error {
	_ = ctx
	if err := os.MkdirAll(f.dir, 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(f.dir, definitionsSnapshotFile), b, 0o644)
}

func (f *FileProvider) Clear(ctx context.Context) error {
	_ = ctx
	_ = os.Remove(filepath.Join(f.dir, definitionsSnapshotFile))
	_ = os.Remove(filepath.Join(f.dir, jwksSnapshotFile))
	return nil
}

func (f *FileProvider) LoadJWKS(ctx context.Context) (*JWKSnap, error) {
	_ = ctx
	b, err := os.ReadFile(filepath.Join(f.dir, jwksSnapshotFile))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var wire struct {
		Set    json.RawMessage `json:"set"`
		Expiry int64           `json:"expiry"`
	}
	if err := json.Unmarshal(b, &wire); err != nil {
		return nil, fmt.Errorf("decode jwks snapshot: %w", err)
	}
	var snap JWKSnap
	if err := json.Unmarshal(wire.Set, &snap.Set); err != nil {
		return nil, fmt.Errorf("decode jwks set: %w", err)
	}
	snap.Expiry = time.Unix(wire.Expiry, 0)
	return &snap, nil
}

func (f *FileProvider) SaveJWKS(ctx context.Context, snap JWKSnap) error {
	_ = ctx
	if err := os.MkdirAll(f.dir, 0o755); err != nil {
		return err
	}
	setBytes, err := json.Marshal(snap.Set)
	if err != nil {
		return err
	}
	wire := struct {
		Set    json.RawMessage `json:"set"`
		Expiry int64           `json:"expiry"`
	}{Set: setBytes, Expiry: snap.Expiry.Unix()}
	b, err := json.Marshal(wire)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(f.dir, jwksSnapshotFile), b, 0o644)
}
