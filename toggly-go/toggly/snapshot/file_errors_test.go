package snapshot

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileProviderRejectsCorruptSnapshots(t *testing.T) {
	dir := t.TempDir()
	p := NewFileProvider(dir)
	ctx := context.Background()
	if err := os.WriteFile(filepath.Join(dir, definitionsSnapshotFile), []byte("invalid-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := p.LoadDefinitions(ctx); err == nil || !strings.Contains(err.Error(), "decode definitions snapshot") {
		t.Fatalf("invalid definitions error = %v", err)
	}
	for _, tc := range []struct {
		name, body, want string
	}{
		{"envelope", "invalid-json", "decode jwks snapshot"},
		{"set", `{"set":"invalid","expiry":1}`, "decode jwks set"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(dir, jwksSnapshotFile), []byte(tc.body), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := p.LoadJWKS(ctx); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("invalid JWKS error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestFileProviderReportsFilesystemFailures(t *testing.T) {
	ctx := context.Background()
	parentFile := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(parentFile, []byte("occupied"), 0o600); err != nil {
		t.Fatal(err)
	}
	p := NewFileProvider(filepath.Join(parentFile, "snapshots"))
	if err := p.SaveDefinitions(ctx, DefinitionsSnapshot{}); err == nil {
		t.Fatal("SaveDefinitions succeeded beneath a regular file")
	}
	if err := p.SaveJWKS(ctx, JWKSnap{}); err == nil {
		t.Fatal("SaveJWKS succeeded beneath a regular file")
	}
	if _, err := p.LoadDefinitions(ctx); err == nil {
		t.Fatal("LoadDefinitions suppressed a non-ENOENT filesystem error")
	}
	if _, err := p.LoadJWKS(ctx); err == nil {
		t.Fatal("LoadJWKS suppressed a non-ENOENT filesystem error")
	}
}
