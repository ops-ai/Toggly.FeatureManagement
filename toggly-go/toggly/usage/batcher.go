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

	mu         sync.Mutex
	perFeature map[string]*featureAgg
	appUnique  map[int32]struct{}
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

func (b *Batcher) Flush(ctx context.Context, client usagepb.UsageClient) error {
	msg := b.buildAndReset()
	if len(msg.Stats) == 0 && len(msg.UniqueUserHashes) == 0 {
		return nil
	}
	_, err := client.SendStats(ctx, msg)
	return err
}

func (b *Batcher) buildAndReset() *usagepb.FeatureStat {
	b.mu.Lock()
	defer b.mu.Unlock()

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

	for feature, agg := range b.perFeature {
		msg := &usagepb.StatMessage{
			Feature:                              feature,
			EnabledCount:                         agg.enabledCount,
			DisabledCount:                        agg.disabledCount,
			UniqueContextIdentifierEnabledCount:  int32(len(agg.uniqueUsersEnabled)),
			UniqueContextIdentifierDisabledCount: int32(len(agg.uniqueUsersDisabled)),
			UsedCount:                            agg.usedCount,
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

	// reset
	b.perFeature = map[string]*featureAgg{}
	b.appUnique = map[int32]struct{}{}

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
