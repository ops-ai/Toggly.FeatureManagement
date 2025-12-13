package usage

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage/usagepb"
)

// Client wraps a gRPC Usage client and a batcher.
type Client struct {
	conn    *grpc.ClientConn
	api     usagepb.UsageClient
	batcher *Batcher

	stop chan struct{}
}

// Dial creates a gRPC usage client.
func Dial(baseURL, appKey, env, instance, appVersion string) (*Client, error) {
	target, err := grpcTarget(baseURL)
	if err != nil {
		return nil, err
	}
	creds := credentials.NewTLS(&tls.Config{})
	conn, err := grpc.Dial(target, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, err
	}
	return &Client{
		conn:    conn,
		api:     usagepb.NewUsageClient(conn),
		batcher: NewBatcher(appKey, env, instance, appVersion),
		stop:    make(chan struct{}),
	}, nil
}

func (c *Client) Close() error {
	close(c.stop)
	return c.conn.Close()
}

// RecordCheck records a feature check.
func (c *Client) RecordCheck(feature string, enabled bool, identity string) {
	c.batcher.RecordCheck(feature, enabled, identity)
}

// RecordUsed records a feature usage.
func (c *Client) RecordUsed(feature string, enabled bool, identity string) {
	c.batcher.RecordUsed(feature, enabled, identity)
}

// Flush sends accumulated stats.
func (c *Client) Flush(ctx context.Context) error {
	return c.batcher.Flush(ctx, c.api)
}

// StartAutoFlush flushes periodically.
func (c *Client) StartAutoFlush(interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-c.stop:
				return
			case <-t.C:
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				_ = c.Flush(ctx)
				cancel()
			}
		}
	}()
}

func grpcTarget(baseURL string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	host := u.Host
	if host == "" {
		host = strings.TrimSuffix(strings.TrimPrefix(baseURL, "https://"), "/")
	}
	if !strings.Contains(host, ":") {
		host = host + ":443"
	}
	return host, nil
}

var _ = fmt.Sprintf
