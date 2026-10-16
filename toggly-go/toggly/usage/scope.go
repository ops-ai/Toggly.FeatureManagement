package usage

import (
	"context"
	"errors"
	"time"
)

// FeatureUsageScope tracks one usage attempt; call Fail to mark failure without returning an error.
// Named for cross-SDK parity (not the Go single-method -er form).
type FeatureUsageScope interface { // NOSONAR godre:S8196
	Fail()
}

type scopeImpl struct {
	failed bool
}

func (s *scopeImpl) Fail() {
	s.failed = true
}

func isUsageCancellation(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// RunUsageScope records attempt, duration, and errors for fn. Does not evaluate feature flags.
// Panics are recorded as failures, then re-panicked.
func RunUsageScope(
	recordAttempt func(),
	recordSuccess func(durationMs int64),
	recordFailure func(durationMs int64),
	fn func(FeatureUsageScope) error,
) (err error) {
	recordAttempt()
	start := time.Now()
	scope := &scopeImpl{}
	defer func() {
		if r := recover(); r != nil {
			recordFailure(elapsedMs(start))
			panic(r)
		}
	}()
	err = fn(scope)
	if err != nil {
		if isUsageCancellation(err) {
			return err
		}
		recordFailure(elapsedMs(start))
		return err
	}
	durationMs := elapsedMs(start)
	if scope.failed {
		recordFailure(durationMs)
	} else {
		recordSuccess(durationMs)
	}
	return nil
}

func elapsedMs(start time.Time) int64 {
	ms := time.Since(start).Milliseconds()
	if ms < 0 {
		return 0
	}
	return ms
}
