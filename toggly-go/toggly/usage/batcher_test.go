package usage

import (
	"testing"
)

func TestBatcher_CheckUsedViewed_VariantStats(t *testing.T) {
	b := NewBatcher("app", "Production", "inst-1", "1.0.0")

	b.RecordCheck("FeatA", true, "user-1")
	b.RecordCheck("FeatA", false, "user-2")
	b.RecordUsed("FeatA", true, "user-1")
	b.RecordView("FeatA", "user-1")
	b.RecordView("FeatA", "user-1") // same identity → one unique viewed hash
	b.RecordView("FeatA", "user-3")

	msg := b.buildAndReset()
	if msg.AppKey != "app" || msg.Environment != "Production" {
		t.Fatalf("unexpected envelope: %+v", msg)
	}
	if msg.GetInstanceName() != "inst-1" || msg.GetAppVersion() != "1.0.0" {
		t.Fatalf("unexpected instance/version: %+v", msg)
	}
	if len(msg.Stats) != 1 {
		t.Fatalf("expected 1 feature stat, got %d", len(msg.Stats))
	}

	st := msg.Stats[0]
	if st.Feature != "FeatA" {
		t.Fatalf("feature = %q", st.Feature)
	}
	if st.EnabledCount != 1 || st.DisabledCount != 1 || st.UsedCount != 1 {
		t.Fatalf("legacy counts: enabled=%d disabled=%d used=%d", st.EnabledCount, st.DisabledCount, st.UsedCount)
	}
	if st.UniqueContextIdentifierEnabledCount != 1 || st.UniqueContextIdentifierDisabledCount != 1 {
		t.Fatalf("unique context counts: enabled=%d disabled=%d", st.UniqueContextIdentifierEnabledCount, st.UniqueContextIdentifierDisabledCount)
	}
	if st.UniqueUsersUsedCount != 1 {
		t.Fatalf("unique users used = %d", st.UniqueUsersUsedCount)
	}
	if len(st.UniqueUserHashes) != 1 {
		t.Fatalf("unique used hashes = %v", st.UniqueUserHashes)
	}
	if len(st.UniqueViewedUserHashes) != 2 {
		t.Fatalf("unique viewed hashes = %v (want 2)", st.UniqueViewedUserHashes)
	}

	en := st.VariantStats["enabled"]
	if en == nil {
		t.Fatal("missing enabled variantStats")
	}
	if en.CheckCount != 1 || en.UsedCount != 1 || en.ViewedCount != 3 {
		t.Fatalf("enabled variantStats: %+v", en)
	}
	dis := st.VariantStats["disabled"]
	if dis == nil || dis.CheckCount != 1 {
		t.Fatalf("disabled variantStats: %+v", dis)
	}

	// App-level uniques: user-1, user-2, user-3
	if msg.TotalUniqueUsers != 3 || len(msg.UniqueUserHashes) != 3 {
		t.Fatalf("app uniques: total=%d hashes=%v", msg.TotalUniqueUsers, msg.UniqueUserHashes)
	}

	// Flush reset — second build should be empty
	empty := b.buildAndReset()
	if len(empty.Stats) != 0 || empty.TotalUniqueUsers != 0 {
		t.Fatalf("expected empty after reset, got %+v", empty)
	}
}

func TestBatcher_ViewOnly_CreatesEnabledVariant(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	b.RecordView("OnlyView", "u1")
	msg := b.buildAndReset()
	if len(msg.Stats) != 1 {
		t.Fatalf("stats len = %d", len(msg.Stats))
	}
	en := msg.Stats[0].VariantStats["enabled"]
	if en == nil || en.ViewedCount != 1 || en.CheckCount != 0 {
		t.Fatalf("expected viewed-only enabled variant: %+v", en)
	}
	if msg.Stats[0].VariantStats["disabled"] != nil {
		t.Fatal("disabled variant should be absent")
	}
}

func TestBatcher_UsedWhenDisabled_DoesNotCountUsed(t *testing.T) {
	b := NewBatcher("app", "Production", "", "")
	b.RecordUsed("Feat", false, "u1")
	msg := b.buildAndReset()
	st := msg.Stats[0]
	if st.UsedCount != 0 {
		t.Fatalf("usedCount = %d, want 0", st.UsedCount)
	}
	// Identity still tracked for used hashes / unique users used (parity with prior Go behavior)
	if st.UniqueUsersUsedCount != 1 || len(st.UniqueUserHashes) != 1 {
		t.Fatalf("expected unique used tracking even when disabled: %+v", st)
	}
}
