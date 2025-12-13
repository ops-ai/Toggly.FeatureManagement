package metrics

import (
	"context"
	"sync"
	"time"

	"github.com/golang/protobuf/ptypes"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/metricspb"
)

// Batcher accumulates metrics and periodically flushes them.
type Batcher struct {
	appKey      string
	environment string
	instance    string

	mu sync.Mutex
	stats        []*metricspb.MetricStatMessage
	counters     []*metricspb.MetricCounterMessage
	observations []*metricspb.MetricObservationMessage
}

func NewBatcher(appKey, env, instance string) *Batcher {
	return &Batcher{appKey: appKey, environment: env, instance: instance}
}

func (b *Batcher) Measure(metric string, value float64, feature *string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.stats = append(b.stats, &metricspb.MetricStatMessage{Metric: metric, Feature: feature, Value: value})
}

func (b *Batcher) Increment(metric string, value float64, feature *string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.counters = append(b.counters, &metricspb.MetricCounterMessage{Metric: metric, Feature: feature, Value: value})
}

func (b *Batcher) Observe(metric string, value float64, feature *string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	ts, _ := ptypes.TimestampProto(time.Now().UTC())
	b.observations = append(b.observations, &metricspb.MetricObservationMessage{Time: ts, Metric: metric, Feature: feature, Value: value})
}

func (b *Batcher) Flush(ctx context.Context, client metricspb.MetricsClient) error {
	msg := b.buildAndReset()
	_, err := client.SendMetrics(ctx, msg)
	return err
}

func (b *Batcher) buildAndReset() *metricspb.MetricStat {
	b.mu.Lock()
	defer b.mu.Unlock()
	ts, _ := ptypes.TimestampProto(time.Now().UTC())
	out := &metricspb.MetricStat{AppKey: b.appKey, Environment: b.environment, Time: ts, Stats: b.stats, Counters: b.counters, Observations: b.observations}
	if b.instance != "" {
		out.InstanceName = &b.instance
	}
	b.stats = nil
	b.counters = nil
	b.observations = nil
	return out
}
