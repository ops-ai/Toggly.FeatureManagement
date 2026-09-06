package autoflush

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestController_StopAndWait_WaitsForInFlightFlush(t *testing.T) {
	c := New()
	entered := atomic.Int32{}
	release := make(chan struct{})

	c.Start(20*time.Millisecond, func(ctx context.Context) error {
		entered.Add(1)
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
		return nil
	})

	deadline := time.Now().Add(2 * time.Second)
	for entered.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("flush never entered")
		}
		time.Sleep(5 * time.Millisecond)
	}

	done := make(chan struct{})
	go func() {
		c.StopAndWait()
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("StopAndWait returned before in-flight flush finished")
	case <-time.After(50 * time.Millisecond):
	}

	close(release)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("StopAndWait did not return after flush released")
	}
}

func TestController_StopAndWait_Idempotent(t *testing.T) {
	c := New()
	c.Start(time.Hour, func(context.Context) error { return nil })
	c.StopAndWait()
	c.StopAndWait()
}
