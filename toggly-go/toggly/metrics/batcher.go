package metrics

import (
	"context"
	"sync"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/metricspb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Batcher accumulates metrics and periodically flushes them via variantValues maps.
type Batcher struct {
	appKey      string
	environment string
	instance    string

	mu           sync.Mutex
	stats        map[aggKey]float64
	counters     map[aggKey]float64
	observations []observation
}

type aggKey struct {
	metric  string
	feature string // empty when no feature
	variant string
}

type observation struct {
	time    time.Time
	metric  string
	feature string
	variant string
	value   float64
}

func NewBatcher(appKey, env, instance string) *Batcher {
	return &Batcher{
		appKey:      appKey,
		environment: env,
		instance:    instance,
		stats:       map[aggKey]float64{},
		counters:    map[aggKey]float64{},
	}
}

// Measure aggregates a measurement under variantValues. Empty variant defaults to "enabled".
func (b *Batcher) Measure(metric string, value float64, feature *string, variant string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.stats[makeKey(metric, feature, variant)] += value
}

// Increment aggregates a counter under variantValues. Empty variant defaults to "enabled".
func (b *Batcher) Increment(metric string, value float64, feature *string, variant string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.counters[makeKey(metric, feature, variant)] += value
}

// Observe records a point-in-time observation under variantValues. Empty variant defaults to "enabled".
func (b *Batcher) Observe(metric string, value float64, feature *string, variant string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	k := makeKey(metric, feature, variant)
	b.observations = append(b.observations, observation{
		time:    time.Now().UTC(),
		metric:  k.metric,
		feature: k.feature,
		variant: k.variant,
		value:   value,
	})
}

func (b *Batcher) Flush(ctx context.Context, client metricspb.MetricsClient) error {
	msg := b.buildAndReset()
	if len(msg.Stats) == 0 && len(msg.Counters) == 0 && len(msg.Observations) == 0 {
		return nil
	}
	_, err := client.SendMetrics(ctx, msg)
	return err
}

func (b *Batcher) buildAndReset() *metricspb.MetricStat {
	b.mu.Lock()
	defer b.mu.Unlock()

	out := &metricspb.MetricStat{
		AppKey:      b.appKey,
		Environment: b.environment,
		Time:        timestamppb.New(time.Now().UTC()),
	}
	if b.instance != "" {
		out.InstanceName = &b.instance
	}

	out.Stats = groupVariantValues(b.stats, func(metric string, feature *string, values map[string]float64) *metricspb.MetricStatMessage {
		return &metricspb.MetricStatMessage{Metric: metric, Feature: feature, VariantValues: values}
	})
	out.Counters = groupVariantValues(b.counters, func(metric string, feature *string, values map[string]float64) *metricspb.MetricCounterMessage {
		return &metricspb.MetricCounterMessage{Metric: metric, Feature: feature, VariantValues: values}
	})

	// Group by precise timestamp (not truncated second), matching .NET's
	// DateTime bag key. If the same variant would overwrite within a group,
	// emit a separate MetricObservationMessage so no values are lost.
	type obsGroupKey struct {
		nano    int64
		metric  string
		feature string
	}
	groups := map[obsGroupKey]*metricspb.MetricObservationMessage{}
	for _, o := range b.observations {
		gk := obsGroupKey{nano: o.time.UnixNano(), metric: o.metric, feature: o.feature}
		msg, ok := groups[gk]
		if !ok || hasVariant(msg.VariantValues, o.variant) {
			msg = &metricspb.MetricObservationMessage{
				Time:          timestamppb.New(o.time),
				Metric:        o.metric,
				VariantValues: map[string]float64{},
			}
			if o.feature != "" {
				f := o.feature
				msg.Feature = &f
			}
			groups[gk] = msg
			out.Observations = append(out.Observations, msg)
		}
		msg.VariantValues[o.variant] = o.value
	}

	b.stats = map[aggKey]float64{}
	b.counters = map[aggKey]float64{}
	b.observations = nil
	return out
}

func hasVariant(values map[string]float64, variant string) bool {
	_, ok := values[variant]
	return ok
}

func makeKey(metric string, feature *string, variant string) aggKey {
	if variant == "" {
		variant = "enabled"
	}
	k := aggKey{metric: metric, variant: variant}
	if feature != nil {
		k.feature = *feature
	}
	return k
}

func groupVariantValues[T any](m map[aggKey]float64, build func(metric string, feature *string, values map[string]float64) T) []T {
	type mf struct {
		metric  string
		feature string
	}
	grouped := map[mf]map[string]float64{}
	for k, v := range m {
		if v == 0 {
			continue
		}
		key := mf{metric: k.metric, feature: k.feature}
		vv, ok := grouped[key]
		if !ok {
			vv = map[string]float64{}
			grouped[key] = vv
		}
		vv[k.variant] = v
	}
	out := make([]T, 0, len(grouped))
	for key, values := range grouped {
		var feature *string
		if key.feature != "" {
			f := key.feature
			feature = &f
		}
		out = append(out, build(key.metric, feature, values))
	}
	return out
}
