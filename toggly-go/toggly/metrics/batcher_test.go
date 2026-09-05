package metrics

import (
	"testing"
)

func TestBatcher_MeasureIncrementObserve_VariantValues(t *testing.T) {
	b := NewBatcher("app", "Production", "inst")

	feat := "FeatA"
	b.Measure("revenue", 10, &feat, "enabled")
	b.Measure("revenue", 5, &feat, "disabled")
	b.Measure("revenue", 3, &feat, "enabled") // aggregate
	b.Measure("standalone", 7, nil, "")        // defaults to enabled

	b.Increment("clicks", 1, &feat, "enabled")
	b.Increment("clicks", 2, &feat, "enabled")

	b.Observe("gauge", 42, &feat, "control")

	msg := b.buildAndReset()
	if msg.AppKey != "app" || msg.GetInstanceName() != "inst" {
		t.Fatalf("envelope: %+v", msg)
	}

	findStat := func(metric string, feature string) map[string]float64 {
		for _, s := range msg.Stats {
			f := ""
			if s.Feature != nil {
				f = *s.Feature
			}
			if s.Metric == metric && f == feature {
				return s.VariantValues
			}
		}
		return nil
	}

	rev := findStat("revenue", "FeatA")
	if rev == nil || rev["enabled"] != 13 || rev["disabled"] != 5 {
		t.Fatalf("revenue variantValues = %v", rev)
	}
	if findStat("revenue", "FeatA") != nil {
		// deprecated Value should remain zero
		for _, s := range msg.Stats {
			if s.Metric == "revenue" && s.Value != 0 {
				t.Fatalf("deprecated Value should be unset, got %v", s.Value)
			}
		}
	}

	stand := findStat("standalone", "")
	if stand == nil || stand["enabled"] != 7 {
		t.Fatalf("standalone = %v", stand)
	}

	var clicks map[string]float64
	for _, c := range msg.Counters {
		if c.Metric == "clicks" && c.Feature != nil && *c.Feature == "FeatA" {
			clicks = c.VariantValues
		}
	}
	if clicks == nil || clicks["enabled"] != 3 {
		t.Fatalf("clicks = %v", clicks)
	}

	if len(msg.Observations) != 1 {
		t.Fatalf("observations len = %d", len(msg.Observations))
	}
	obs := msg.Observations[0]
	if obs.Metric != "gauge" || obs.VariantValues["control"] != 42 {
		t.Fatalf("observation = %+v", obs)
	}
	if obs.Value != 0 {
		t.Fatalf("deprecated observation Value should be unset, got %v", obs.Value)
	}

	empty := b.buildAndReset()
	if len(empty.Stats) != 0 || len(empty.Counters) != 0 || len(empty.Observations) != 0 {
		t.Fatalf("expected empty after reset: %+v", empty)
	}
}

func TestBatcher_DefaultVariantEnabled(t *testing.T) {
	b := NewBatcher("app", "Production", "")
	b.Increment("x", 1, nil, "")
	msg := b.buildAndReset()
	if len(msg.Counters) != 1 || msg.Counters[0].VariantValues["enabled"] != 1 {
		t.Fatalf("want enabled=1, got %+v", msg.Counters)
	}
}
