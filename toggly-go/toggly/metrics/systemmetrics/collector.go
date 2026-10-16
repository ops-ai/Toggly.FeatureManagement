// Package systemmetrics collects opt-in process observations for Toggly metrics.
package systemmetrics

import (
	"bufio"
	"context"
	"math"
	"os"
	"runtime"
	"runtime/metrics"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/autoflush"
)

const (
	// DefaultInterval is the default sampling period (10s).
	DefaultInterval = 10 * time.Second
)

// Observation is one sampled metric name and value.
type Observation struct {
	Metric string
	Value  float64
}

// ObserveFunc records a point-in-time metric observation.
type ObserveFunc func(metric string, value float64)

// Sampler returns observations for one tick (tests / injection).
type Sampler func() []Observation

// Collector samples process metrics on an interval and calls Observe.
type Collector struct {
	observe  ObserveFunc
	interval time.Duration
	sampler  Sampler
	flush    *autoflush.Controller

	mu             sync.Mutex
	lastCPU        *cpuSample
	lastHeapAllocs uint64
	lastSampleAt   time.Time
	started        bool
}

type cpuSample struct {
	userMicros   int64
	systemMicros int64
	at           time.Time
}

// New builds a collector. observe is required.
func New(observe ObserveFunc, opts ...Option) *Collector {
	c := &Collector{
		observe:  observe,
		interval: DefaultInterval,
		flush:    autoflush.New(),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Option configures a Collector.
type Option func(*Collector)

// WithInterval overrides the sampling interval.
func WithInterval(d time.Duration) Option {
	return func(c *Collector) {
		if d > 0 {
			c.interval = d
		}
	}
}

// WithSampler replaces the default sampler (tests).
func WithSampler(s Sampler) Option {
	return func(c *Collector) {
		if s != nil {
			c.sampler = s
		}
	}
}

// Start begins periodic sampling. Idempotent.
func (c *Collector) Start() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.started {
		return
	}
	c.started = true
	c.seedCPU()
	c.flush.Start(c.interval, func(context.Context) error {
		c.Tick()
		return nil
	})
}

// Stop ends sampling and waits for the background loop.
func (c *Collector) Stop() {
	c.mu.Lock()
	if !c.started {
		c.mu.Unlock()
		return
	}
	c.started = false
	c.mu.Unlock()
	c.flush.StopAndWait()
}

// Tick runs one sample cycle (for tests).
func (c *Collector) Tick() {
	c.mu.Lock()
	started := c.started
	c.mu.Unlock()
	if !started {
		return
	}
	defer func() { _ = recover() }()

	var samples []Observation
	if c.sampler != nil {
		samples = c.sampler()
	} else {
		samples = c.buildSample()
	}
	for _, obs := range samples {
		if !validValue(obs.Value) {
			continue
		}
		c.observe(obs.Metric, obs.Value)
	}
}

func (c *Collector) seedCPU() {
	usage, ok := readRusageCPU()
	if !ok {
		return
	}
	c.lastCPU = &cpuSample{
		userMicros:   usage.user,
		systemMicros: usage.system,
		at:           time.Now(),
	}
	c.lastSampleAt = c.lastCPU.at
	if v, ok := readHeapAllocsBytes(); ok {
		c.lastHeapAllocs = v
	}
}

func (c *Collector) buildSample() []Observation {
	out := make([]Observation, 0, 6)
	now := time.Now()

	if cpu := c.sampleCPU(now); cpu != nil {
		out = append(out, *cpu)
	}
	if mem := sampleMemoryWorkingSet(); mem != nil {
		out = append(out, *mem)
	}
	if heap := sampleGCHeapSize(); heap != nil {
		out = append(out, *heap)
	}
	if rate := c.sampleAllocationRate(now); rate != nil {
		out = append(out, *rate)
	}
	out = append(out, Observation{Metric: "GoroutineCount", Value: float64(runtime.NumGoroutine())})
	return out
}

func (c *Collector) sampleCPU(now time.Time) *Observation {
	cur, ok := readRusageCPU()
	if !ok {
		return nil
	}
	prev := c.lastCPU
	c.lastCPU = &cpuSample{userMicros: cur.user, systemMicros: cur.system, at: now}
	if prev == nil {
		return nil
	}
	wall := now.Sub(prev.at)
	if wall <= 0 {
		return nil
	}
	cpuUs := (cur.user - prev.userMicros) + (cur.system - prev.systemMicros)
	if cpuUs < 0 {
		return nil
	}
	wallUs := float64(wall.Microseconds())
	if wallUs < 1 {
		wallUs = 1
	}
	nCPU := float64(runtime.NumCPU())
	if nCPU < 1 {
		nCPU = 1
	}
	pct := (float64(cpuUs) / wallUs / nCPU) * 100
	if !validValue(pct) || pct < 0 {
		return nil
	}
	if pct > 100 {
		pct = 100
	}
	return &Observation{Metric: "CpuUsage", Value: pct}
}

func (c *Collector) sampleAllocationRate(now time.Time) *Observation {
	cur, ok := readHeapAllocsBytes()
	if !ok {
		return nil
	}
	prev := c.lastHeapAllocs
	at := c.lastSampleAt
	c.lastHeapAllocs = cur
	c.lastSampleAt = now
	if at.IsZero() || cur < prev {
		return nil
	}
	secs := now.Sub(at).Seconds()
	if secs <= 0 {
		return nil
	}
	rate := float64(cur-prev) / secs
	if !validValue(rate) || rate < 0 {
		return nil
	}
	return &Observation{Metric: "AllocationRate", Value: rate}
}

func sampleGCHeapSize() *Observation {
	samples := []metrics.Sample{{Name: "/gc/heap/live:bytes"}}
	metrics.Read(samples)
	sample := samples[0]
	if sample.Value.Kind() != metrics.KindUint64 {
		return nil
	}
	v := float64(sample.Value.Uint64())
	if !validValue(v) {
		return nil
	}
	return &Observation{Metric: "GCHeapSize", Value: v}
}

func readHeapAllocsBytes() (uint64, bool) {
	samples := []metrics.Sample{{Name: "/gc/heap/allocs:bytes"}}
	metrics.Read(samples)
	sample := samples[0]
	if sample.Value.Kind() != metrics.KindUint64 {
		return 0, false
	}
	return sample.Value.Uint64(), true
}

type rusageCPU struct {
	user   int64
	system int64
}

func readRusageCPU() (rusageCPU, bool) {
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return rusageCPU{}, false
	}
	user := ru.Utime.Sec*1_000_000 + int64(ru.Utime.Usec)
	system := ru.Stime.Sec*1_000_000 + int64(ru.Stime.Usec)
	return rusageCPU{user: user, system: system}, true
}

func sampleMemoryWorkingSet() *Observation {
	if rss, ok := readLinuxStatmRSS(); ok {
		return &Observation{Metric: "MemoryWorkingSet", Value: float64(rss)}
	}
	// Fallback: ru_maxrss (KB on Linux, bytes on macOS/BSD).
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return nil
	}
	rss := int64(ru.Maxrss)
	if rss <= 0 {
		return nil
	}
	if runtime.GOOS == "linux" || runtime.GOOS == "android" {
		rss *= 1024
	}
	return &Observation{Metric: "MemoryWorkingSet", Value: float64(rss)}
}

func readLinuxStatmRSS() (uint64, bool) {
	if runtime.GOOS != "linux" && runtime.GOOS != "android" {
		return 0, false
	}
	f, err := os.Open("/proc/self/statm")
	if err != nil {
		return 0, false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	if !sc.Scan() {
		return 0, false
	}
	fields := strings.Fields(sc.Text())
	if len(fields) < 2 {
		return 0, false
	}
	pages, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return 0, false
	}
	pageSize := uint64(os.Getpagesize())
	return pages * pageSize, true
}

func validValue(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
