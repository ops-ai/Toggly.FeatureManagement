package systemmetrics

import (
	"math"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestWithIntervalOverridesDefault(t *testing.T) {
	c := New(func(string, float64) { /* observer unused in this construction test */ }, WithInterval(3*time.Second))
	if c.interval != 3*time.Second {
		t.Fatalf("interval = %v, want 3s", c.interval)
	}
	ignored := New(func(string, float64) { /* observer unused in this construction test */ }, WithInterval(0))
	if ignored.interval != DefaultInterval {
		t.Fatalf("interval = %v, want default %v", ignored.interval, DefaultInterval)
	}
}

func TestCollectorStartIsIdempotent(t *testing.T) {
	c := New(func(string, float64) { /* observer unused in this construction test */ }, WithSampler(func() []Observation {
		return nil
	}), WithInterval(time.Hour))
	c.Start()
	c.Start()
	c.Stop()
}

func TestCollectorStopNoOpWhenNotStarted(t *testing.T) {
	c := New(func(string, float64) { /* observer unused in this construction test */ })
	c.Stop()
}

func TestCollectorSkipsNonFiniteObservations(t *testing.T) {
	var count int
	c := New(func(string, float64) { count++ }, WithSampler(func() []Observation {
		return []Observation{
			{Metric: "CpuUsage", Value: math.NaN()},
			{Metric: "CpuUsage", Value: 1.5},
		}
	}))
	c.mu.Lock()
	c.started = true
	c.mu.Unlock()
	c.Tick()
	if count != 1 {
		t.Fatalf("count = %d, want 1", count)
	}
}

func TestCollectorBuildSampleWithoutSampler(t *testing.T) {
	var metrics []string
	c := New(func(metric string, _ float64) {
		metrics = append(metrics, metric)
	})
	c.mu.Lock()
	c.started = true
	c.seedCPU()
	c.mu.Unlock()
	c.Tick()
	if len(metrics) == 0 {
		t.Fatal("expected default buildSample to emit at least one metric")
	}
}

func TestSampleCPUSkipsZeroWallDuration(t *testing.T) {
	now := time.Now()
	c := New(func(string, float64) { /* observer unused in this construction test */ })
	c.lastCPU = &cpuSample{userMicros: 100, systemMicros: 0, at: now}
	if obs := c.sampleCPU(now); obs != nil {
		t.Fatalf("expected nil observation for zero wall duration, got %+v", obs)
	}
}

func TestSampleCPURejectsRegressiveUsage(t *testing.T) {
	c := New(func(string, float64) { /* observer unused in this construction test */ })
	c.mu.Lock()
	c.started = true
	c.lastCPU = &cpuSample{
		userMicros:   1_000_000_000_000,
		systemMicros: 0,
		at:           time.Now().Add(-time.Second),
	}
	c.mu.Unlock()
	c.Tick()
}

func TestReadLinuxStatmRSSSkipsNonLinux(t *testing.T) {
	if runtime.GOOS == "linux" || runtime.GOOS == "android" {
		t.Skip("linux/android use live /proc/self/statm")
	}
	if _, ok := readLinuxStatmRSS(); ok {
		t.Fatal("expected non-linux platforms to skip statm RSS")
	}
}

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
	c := New(func(string, float64) { /* observer unused in this construction test */ })
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
