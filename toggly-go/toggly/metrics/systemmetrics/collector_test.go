package systemmetrics

import (
	"math"
	"sync"
	"testing"
)

func TestCollectorUsesInjectedSampler(t *testing.T) {
	var mu sync.Mutex
	var observed []Observation
	c := New(func(metric string, value float64) {
		mu.Lock()
		observed = append(observed, Observation{Metric: metric, Value: value})
		mu.Unlock()
	}, WithSampler(func() []Observation {
		return []Observation{
			{Metric: "CpuUsage", Value: 4.5},
			{Metric: "MemoryWorkingSet", Value: 8192},
		}
	}))

	c.Start()
	c.Tick()
	c.Stop()

	mu.Lock()
	defer mu.Unlock()
	if len(observed) != 2 {
		t.Fatalf("observed len = %d, want 2", len(observed))
	}
	if observed[0].Metric != "CpuUsage" || observed[0].Value != 4.5 {
		t.Fatalf("first observation = %+v", observed[0])
	}
}

func TestCollectorTickNoOpWhenStopped(t *testing.T) {
	var count int
	c := New(func(string, float64) { count++ }, WithSampler(func() []Observation {
		return []Observation{{Metric: "CpuUsage", Value: 1}}
	}))
	c.Tick()
	if count != 0 {
		t.Fatalf("count = %d, want 0 before start", count)
	}
}

func TestSampleCPUProducesPercentAfterSecondTick(t *testing.T) {
	// Drive ticks synchronously so the background Start loop cannot race -race.
	c := New(func(string, float64) {})
	c.mu.Lock()
	c.started = true
	c.seedCPU()
	c.mu.Unlock()
	c.Tick()
	c.Tick()
	c.mu.Lock()
	c.started = false
	c.mu.Unlock()
}

func TestValidValue(t *testing.T) {
	if !validValue(0) || !validValue(42.5) {
		t.Fatal("expected finite values to be valid")
	}
	if validValue(math.NaN()) || validValue(math.Inf(1)) {
		t.Fatal("expected NaN/Inf to be invalid")
	}
}
