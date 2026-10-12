package usage

import (
	"context"
	"errors"
	"testing"
)

func TestRunUsageScope_Success(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	err := RunUsageScope(
		func() { b.RecordUsageAttempt("Feat", "") },
		func(ms int64) { b.RecordUsageDuration("Feat", ms, false) },
		func(ms int64) {
			b.RecordUsageError("Feat", 1)
			b.RecordUsageDuration("Feat", ms, true)
		},
		func(FeatureUsageScope) error { return nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	msg := b.buildAndReset()
	en := msg.Stats[0].VariantStats["enabled"]
	if en.UsedCount != 1 || en.ErrorCount != 0 {
		t.Fatalf("got %+v", en)
	}
}

func TestRunUsageScope_Failure(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	err := RunUsageScope(
		func() { b.RecordUsageAttempt("Feat", "") },
		func(ms int64) { b.RecordUsageDuration("Feat", ms, false) },
		func(ms int64) {
			b.RecordUsageError("Feat", 1)
			b.RecordUsageDuration("Feat", ms, true)
		},
		func(FeatureUsageScope) error { return errors.New("boom") },
	)
	if err == nil {
		t.Fatal("expected error")
	}
	en := b.buildAndReset().Stats[0].VariantStats["enabled"]
	if en.ErrorCount != 1 || en.UsedCount != 1 {
		t.Fatalf("got %+v", en)
	}
}

func TestRunUsageScope_Cancelled(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	err := RunUsageScope(
		func() { b.RecordUsageAttempt("Feat", "") },
		func(ms int64) { b.RecordUsageDuration("Feat", ms, false) },
		func(ms int64) {
			b.RecordUsageError("Feat", 1)
			b.RecordUsageDuration("Feat", ms, true)
		},
		func(FeatureUsageScope) error { return context.Canceled },
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
	en := b.buildAndReset().Stats[0].VariantStats["enabled"]
	if en.UsedCount != 1 || en.ErrorCount != 0 || en.DurationSumMs != 0 {
		t.Fatalf("got %+v", en)
	}
}
