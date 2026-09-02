package eval

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestComputePercentile_Golden(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(thisFile), "testdata", "eval-percentile-golden.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	var rows []struct {
		FeatureKey string  `json:"featureKey"`
		UserID     string  `json:"userId"`
		Bucket     float64 `json:"bucket"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("empty golden file")
	}
	for _, row := range rows {
		got := ComputePercentile(row.UserID, row.FeatureKey)
		if math.Abs(got-row.Bucket) > 1e-12 {
			t.Fatalf("%s/%s: got %v want %v", row.FeatureKey, row.UserID, got, row.Bucket)
		}
	}
}

func TestComputePercentile_StickyAcrossFeatures(t *testing.T) {
	a := ComputePercentile("user-123", "demo-feature")
	b := ComputePercentile("user-123", "demo-feature")
	c := ComputePercentile("user-123", "other-flag")
	if a != b {
		t.Fatalf("not sticky: %v vs %v", a, b)
	}
	if a == c {
		t.Fatalf("expected different buckets across features")
	}
}
