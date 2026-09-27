package metrics

import (
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/metricspb"
)

func TestBatcher_MeasureIncrementObserve_VariantValues(t *testing.T) {
	b := NewBatcher("app", "Production", "inst")

	feat := "FeatA"
	b.Measure("revenue", 10, &feat, "enabled")
	b.Measure("revenue", 5, &feat, "disabled")
	b.Measure("revenue", 3, &feat, "enabled") // aggregate
	b.Measure("standalone", 7, nil, "")       // defaults to enabled

	b.Increment("clicks", 1, &feat, "enabled")
	b.Increment("clicks", 2, &feat, "enabled")

	b.Observe("gauge", 42, &feat, "control")

	msg := b.buildAndReset()
	if msg.AppKey != "app" || msg.GetInstanceName() != "inst" {
		t.Fatalf("envelope: %+v", msg)
	}

	rev := findStat(msg, "revenue", "FeatA")
	if rev == nil || rev["enabled"] != 13 || rev["disabled"] != 5 {
		t.Fatalf("revenue variantValues = %v", rev)
	}

	stand := findStat(msg, "standalone", "")
	if stand == nil || stand["enabled"] != 7 {
		t.Fatalf("standalone = %v", stand)
	}

	clicks := findCounter(msg, "clicks", "FeatA")
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

	empty := b.buildAndReset()
	if len(empty.Stats) != 0 || len(empty.Counters) != 0 || len(empty.Observations) != 0 {
		t.Fatalf("expected empty after reset: %+v", empty)
	}
}

func findStat(msg *metricspb.MetricStat, metric, feature string) map[string]float64 {
	for _, stat := range msg.Stats {
		actualFeature := ""
		if stat.Feature != nil {
			actualFeature = *stat.Feature
		}
		if stat.Metric == metric && actualFeature == feature {
			return stat.VariantValues
		}
	}
	return nil
}

func findCounter(msg *metricspb.MetricStat, metric, feature string) map[string]float64 {
	for _, counter := range msg.Counters {
		if counter.Metric == metric && counter.Feature != nil && *counter.Feature == feature {
			return counter.VariantValues
		}
	}
	return nil
}

func TestBatcher_DefaultVariantEnabled(t *testing.T) {
	b := NewBatcher("app", "Production", "")
	b.Increment("x", 1, nil, "")
	msg := b.buildAndReset()
	if len(msg.Counters) != 1 || msg.Counters[0].VariantValues["enabled"] != 1 {
		t.Fatalf("want enabled=1, got %+v", msg.Counters)
	}
}

func TestBatcher_SameSecondObservations_BothSurviveFlush(t *testing.T) {
	b := NewBatcher("app", "Production", "")
	feat := "FeatA"
	ts := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)

	// Two observations in the same Unix second (and one exact timestamp
	// collision) must both survive Flush — no overwrite of same-variant values.
	b.mu.Lock()
	b.observations = []observation{
		{time: ts, metric: "gauge", feature: feat, variant: "control", value: 10},
		{time: ts.Add(250 * time.Millisecond), metric: "gauge", feature: feat, variant: "control", value: 20},
		{time: ts.Add(250 * time.Millisecond), metric: "gauge", feature: feat, variant: "control", value: 30},
	}
	b.mu.Unlock()

	msg := b.buildAndReset()
	seen := map[float64]bool{}
	for _, o := range msg.Observations {
		if o.Metric != "gauge" {
			continue
		}
		if v, ok := o.VariantValues["control"]; ok {
			seen[v] = true
		}
	}
	for _, want := range []float64{10, 20, 30} {
		if !seen[want] {
			t.Fatalf("missing observation value %v in %+v (seen=%v)", want, msg.Observations, seen)
		}
	}
}
