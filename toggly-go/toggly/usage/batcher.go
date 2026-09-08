package usage

import (
	"context"
	"hash/fnv"
	"sync"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage/usagepb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Batcher accumulates usage stats and periodically flushes them.
//
// This mirrors the .NET behavior at a high level (batched send every minute).
type Batcher struct {
	appKey       string
	environment  string
	instance     string
	appVersion   string
	processStart time.Time

	mu                    sync.Mutex
	perFeature            map[string]*featureAgg
	appUnique             map[int32]struct{}
	definitionCacheHits   int32
	definitionCacheMisses int32
}

type featureAgg struct {
	enabledCount  int32
	disabledCount int32
	usedCount     int32
	viewedCount   int32

	uniqueUsersEnabled  map[int32]struct{}
	uniqueUsersDisabled map[int32]struct{}
	uniqueUsersUsed     map[int32]struct{}

	uniqueUsedHashes   map[int32]struct{}
	uniqueViewedHashes map[int32]struct{}
}

// BatchSnapshot is a restoreable copy of drained batcher state (feature stats,
// app-unique hashes, and definition-cache counters).
type BatchSnapshot struct {
	perFeature            map[string]*featureAgg
	appUnique             map[int32]struct{}
	definitionCacheHits   int32
	definitionCacheMisses int32
}

// DrainedBatch is the wire payload plus a snapshot for failed-send restore.
type DrainedBatch struct {
	Payload  *usagepb.FeatureStat
	Snapshot *BatchSnapshot
}

func NewBatcher(appKey, environment, instance, appVersion string) *Batcher {
	return &Batcher{
		appKey:       appKey,
		environment:  environment,
		instance:     instance,
		appVersion:   appVersion,
		processStart: time.Now().UTC(),
		perFeature:   map[string]*featureAgg{},
		appUnique:    map[int32]struct{}{},
	}
}

// RecordDefinitionCacheHit counts a definition-refresh outcome served from
// local/cache (not a new revision).
func (b *Batcher) RecordDefinitionCacheHit() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.definitionCacheHits++
}

// RecordDefinitionCacheMiss counts a definition-refresh that applied a new
// revision from the network.
func (b *Batcher) RecordDefinitionCacheMiss() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.definitionCacheMisses++
}

func (b *Batcher) RecordCheck(feature string, enabled bool, identity string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	agg := b.get(feature)
	if enabled {
		agg.enabledCount++
	} else {
		agg.disabledCount++
	}
	if identity != "" {
		h := hashIdentity(identity)
		b.appUnique[h] = struct{}{}
		if enabled {
			agg.uniqueUsersEnabled[h] = struct{}{}
		} else {
			agg.uniqueUsersDisabled[h] = struct{}{}
		}
	}
}

func (b *Batcher) RecordUsed(feature string, enabled bool, identity string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	agg := b.get(feature)
	// .NET maps used counts onto the "enabled" variant; only count when enabled.
	if enabled {
		agg.usedCount++
	}
	if identity != "" {
		h := hashIdentity(identity)
		b.appUnique[h] = struct{}{}
		agg.uniqueUsersUsed[h] = struct{}{}
		agg.uniqueUsedHashes[h] = struct{}{}
	}
}

// RecordView records a feature "viewed" event (rendered/displayed).
// Views are associated with the "enabled" variant on the wire (matching .NET).
func (b *Batcher) RecordView(feature string, identity string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	agg := b.get(feature)
	agg.viewedCount++
	if identity != "" {
		h := hashIdentity(identity)
		b.appUnique[h] = struct{}{}
		agg.uniqueViewedHashes[h] = struct{}{}
	}
}

func (b *Batcher) isEmptyUnlocked() bool {
	return len(b.perFeature) == 0 &&
		len(b.appUnique) == 0 &&
		b.definitionCacheHits == 0 &&
		b.definitionCacheMisses == 0
}

// Flush exports pending stats, sends them, and restores the full batch on
// SendStats failure (merging with any records accumulated during the in-flight send).
func (b *Batcher) Flush(ctx context.Context, client usagepb.UsageClient) error {
	drained := b.exportAndReset()
	if drained == nil {
		return nil
	}
	_, err := client.SendStats(ctx, drained.Payload)
	if err != nil {
		b.restore(drained.Snapshot)
		return err
	}
	return nil
}

// exportAndReset builds the SendStats payload and clears pending state,
// returning a snapshot for failed-send restore.
func (b *Batcher) exportAndReset() *DrainedBatch {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.isEmptyUnlocked() {
		return nil
	}

	snapshot := cloneSnapshot(b.perFeature, b.appUnique, b.definitionCacheHits, b.definitionCacheMisses)
	msg := b.buildPayloadUnlocked()

	b.perFeature = map[string]*featureAgg{}
	b.appUnique = map[int32]struct{}{}
	b.definitionCacheHits = 0
	b.definitionCacheMisses = 0

	return &DrainedBatch{Payload: msg, Snapshot: snapshot}
}

// buildAndReset is retained for tests; prefer exportAndReset for flush+restore.
func (b *Batcher) buildAndReset() *usagepb.FeatureStat {
	drained := b.exportAndReset()
	if drained == nil {
		return &usagepb.FeatureStat{
			AppKey:      b.appKey,
			Environment: b.environment,
			Time:        timestamppb.New(time.Now().UTC()),
			Stats:       []*usagepb.StatMessage{},
		}
	}
	return drained.Payload
}

func (b *Batcher) buildPayloadUnlocked() *usagepb.FeatureStat {
	now := time.Now().UTC()

	out := &usagepb.FeatureStat{
		AppKey:           b.appKey,
		Environment:      b.environment,
		Time:             timestamppb.New(now),
		Stats:            []*usagepb.StatMessage{},
		TotalUniqueUsers: int32(len(b.appUnique)),
		UniqueUserHashes: keys(b.appUnique),
	}
	if b.instance != "" {
		out.InstanceName = &b.instance
	}
	if b.appVersion != "" {
		out.AppVersion = &b.appVersion
	}
	out.ProcessStartTime = timestamppb.New(b.processStart)

	if b.definitionCacheHits > 0 {
		hits := b.definitionCacheHits
		out.DefinitionCacheHits = &hits
	}
	if b.definitionCacheMisses > 0 {
		misses := b.definitionCacheMisses
		out.DefinitionCacheMisses = &misses
	}

	for feature, agg := range b.perFeature {
		// Do not populate deprecated StatMessage scalars (enabledCount,
		// disabledCount, usedCount, uniqueRequest*); send via variantStats.
		msg := &usagepb.StatMessage{
			Feature:                              feature,
			UniqueContextIdentifierEnabledCount:  int32(len(agg.uniqueUsersEnabled)),
			UniqueContextIdentifierDisabledCount: int32(len(agg.uniqueUsersDisabled)),
			UniqueUsersUsedCount:                 int32(len(agg.uniqueUsersUsed)),
			UniqueUserHashes:                     keys(agg.uniqueUsedHashes),
			UniqueViewedUserHashes:               keys(agg.uniqueViewedHashes),
			VariantStats:                         map[string]*usagepb.VariantStats{},
		}

		if agg.enabledCount > 0 || agg.usedCount > 0 || agg.viewedCount > 0 {
			msg.VariantStats["enabled"] = &usagepb.VariantStats{
				CheckCount:  agg.enabledCount,
				UsedCount:   agg.usedCount,
				ViewedCount: agg.viewedCount,
			}
		}
		if agg.disabledCount > 0 {
			msg.VariantStats["disabled"] = &usagepb.VariantStats{
				CheckCount: agg.disabledCount,
			}
		}

		out.Stats = append(out.Stats, msg)
	}

	return out
}

// restore merges a drained snapshot back into pending state after send failure.
// Additive so counters recorded while the send was in flight are preserved.
func (b *Batcher) restore(snapshot *BatchSnapshot) {
	if snapshot == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	b.definitionCacheHits += snapshot.definitionCacheHits
	b.definitionCacheMisses += snapshot.definitionCacheMisses

	for h := range snapshot.appUnique {
		b.appUnique[h] = struct{}{}
	}

	for feature, snapAgg := range snapshot.perFeature {
		agg := b.get(feature)
		agg.enabledCount += snapAgg.enabledCount
		agg.disabledCount += snapAgg.disabledCount
		agg.usedCount += snapAgg.usedCount
		agg.viewedCount += snapAgg.viewedCount
		for h := range snapAgg.uniqueUsersEnabled {
			agg.uniqueUsersEnabled[h] = struct{}{}
		}
		for h := range snapAgg.uniqueUsersDisabled {
			agg.uniqueUsersDisabled[h] = struct{}{}
		}
		for h := range snapAgg.uniqueUsersUsed {
			agg.uniqueUsersUsed[h] = struct{}{}
		}
		for h := range snapAgg.uniqueUsedHashes {
			agg.uniqueUsedHashes[h] = struct{}{}
		}
		for h := range snapAgg.uniqueViewedHashes {
			agg.uniqueViewedHashes[h] = struct{}{}
		}
	}
}

func cloneSnapshot(perFeature map[string]*featureAgg, appUnique map[int32]struct{}, hits, misses int32) *BatchSnapshot {
	cloned := make(map[string]*featureAgg, len(perFeature))
	for feature, agg := range perFeature {
		cloned[feature] = cloneFeatureAgg(agg)
	}
	app := make(map[int32]struct{}, len(appUnique))
	for h := range appUnique {
		app[h] = struct{}{}
	}
	return &BatchSnapshot{
		perFeature:            cloned,
		appUnique:             app,
		definitionCacheHits:   hits,
		definitionCacheMisses: misses,
	}
}

func cloneFeatureAgg(agg *featureAgg) *featureAgg {
	return &featureAgg{
		enabledCount:        agg.enabledCount,
		disabledCount:       agg.disabledCount,
		usedCount:           agg.usedCount,
		viewedCount:         agg.viewedCount,
		uniqueUsersEnabled:  cloneIntSet(agg.uniqueUsersEnabled),
		uniqueUsersDisabled: cloneIntSet(agg.uniqueUsersDisabled),
		uniqueUsersUsed:     cloneIntSet(agg.uniqueUsersUsed),
		uniqueUsedHashes:    cloneIntSet(agg.uniqueUsedHashes),
		uniqueViewedHashes:  cloneIntSet(agg.uniqueViewedHashes),
	}
}

func cloneIntSet(m map[int32]struct{}) map[int32]struct{} {
	out := make(map[int32]struct{}, len(m))
	for k := range m {
		out[k] = struct{}{}
	}
	return out
}

func (b *Batcher) get(feature string) *featureAgg {
	agg, ok := b.perFeature[feature]
	if ok {
		return agg
	}
	agg = &featureAgg{
		uniqueUsersEnabled:  map[int32]struct{}{},
		uniqueUsersDisabled: map[int32]struct{}{},
		uniqueUsersUsed:     map[int32]struct{}{},
		uniqueUsedHashes:    map[int32]struct{}{},
		uniqueViewedHashes:  map[int32]struct{}{},
	}
	b.perFeature[feature] = agg
	return agg
}

func hashIdentity(s string) int32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return int32(h.Sum32())
}

func keys(m map[int32]struct{}) []int32 {
	out := make([]int32, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
