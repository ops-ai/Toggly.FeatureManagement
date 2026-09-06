package autoflush

import (
	"context"
	"sync"
	"time"
)

// Controller owns the stop signal and WaitGroup for a periodic flush loop.
type Controller struct {
	stop chan struct{}
	wg   sync.WaitGroup
}

// New returns a controller ready for Start / StopAndWait.
func New() *Controller {
	return &Controller{stop: make(chan struct{})}
}

// Start runs flush on interval until StopAndWait. Safe to call once per controller.
func (c *Controller) Start(interval time.Duration, flush func(context.Context) error) {
	if interval <= 0 {
		interval = time.Minute
	}
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-c.stop:
				return
			case <-t.C:
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				_ = flush(ctx)
				cancel()
			}
		}
	}()
}

// StopAndWait closes the stop channel (idempotent) and waits for Start's goroutine
// to finish, including any in-flight flush.
func (c *Controller) StopAndWait() {
	select {
	case <-c.stop:
	default:
		close(c.stop)
	}
	c.wg.Wait()
}
