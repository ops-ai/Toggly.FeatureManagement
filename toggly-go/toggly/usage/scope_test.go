package usage

import (
	"context"
	"errors"
	"testing"
)

const usageScopeGotFmt = "got %+v"

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
		t.Fatalf(usageScopeGotFmt, en)
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
		t.Fatalf(usageScopeGotFmt, en)
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
		t.Fatalf(usageScopeGotFmt, en)
	}
}

func TestRunUsageScope_PanicRecordsFailure(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
		en := b.buildAndReset().Stats[0].VariantStats["enabled"]
		if en.UsedCount != 1 || en.ErrorCount != 1 {
			t.Fatalf(usageScopeGotFmt, en)
		}
	}()
	_ = RunUsageScope(
		func() { b.RecordUsageAttempt("Feat", "") },
		func(ms int64) { b.RecordUsageDuration("Feat", ms, false) },
		func(ms int64) {
			b.RecordUsageError("Feat", 1)
			b.RecordUsageDuration("Feat", ms, true)
		},
		func(FeatureUsageScope) error {
			panic("boom")
		},
	)
}

func TestRunUsageScope_SoftFail(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	err := RunUsageScope(
		func() { b.RecordUsageAttempt("Feat", "") },
		func(ms int64) { b.RecordUsageDuration("Feat", ms, false) },
		func(ms int64) {
			b.RecordUsageError("Feat", 1)
			b.RecordUsageDuration("Feat", ms, true)
		},
		func(scope FeatureUsageScope) error {
			scope.Fail()
			return nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	en := b.buildAndReset().Stats[0].VariantStats["enabled"]
	if en.UsedCount != 1 || en.ErrorCount != 1 {
		t.Fatalf(usageScopeGotFmt, en)
	}
}

func TestRunUsageScope_DeadlineExceededIsCancellation(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	err := RunUsageScope(
		func() { b.RecordUsageAttempt("Feat", "") },
		func(ms int64) { b.RecordUsageDuration("Feat", ms, false) },
		func(ms int64) {
			b.RecordUsageError("Feat", 1)
			b.RecordUsageDuration("Feat", ms, true)
		},
		func(FeatureUsageScope) error { return context.DeadlineExceeded },
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v", err)
	}
	en := b.buildAndReset().Stats[0].VariantStats["enabled"]
	if en.UsedCount != 1 || en.ErrorCount != 0 || en.DurationSumMs != 0 {
		t.Fatalf(usageScopeGotFmt, en)
	}
}

func TestBatcher_RecordUsageDurationAndError(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	b.RecordUsageAttempt("Feat", "u1")
	b.RecordUsageDuration("Feat", 12, false)
	b.RecordUsageError("Feat", 2)
	b.RecordUsageDuration("Feat", 9, true)
	en := b.buildAndReset().Stats[0].VariantStats["enabled"]
	if en.UsedCount != 1 || en.ErrorCount != 2 || en.DurationSumMs != 12 || en.ErrorDurationSumMs != 9 {
		t.Fatalf(usageScopeGotFmt, en)
	}
}
