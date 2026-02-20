package metrics

import (
	"context"
	"crypto/tls"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/metricspb"
)

// Client wraps a gRPC Metrics client and a batcher.
type Client struct {
	conn    *grpc.ClientConn
	api     metricspb.MetricsClient
	batcher *Batcher

	stop chan struct{}
}

func Dial(baseURL, appKey, env, instance string) (*Client, error) {
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
		api:     metricspb.NewMetricsClient(conn),
		batcher: NewBatcher(appKey, env, instance),
		stop:    make(chan struct{}),
	}, nil
}

func (c *Client) Close() error {
	close(c.stop)
	return c.conn.Close()
}

func (c *Client) Measure(metric string, value float64, feature *string) {
	c.batcher.Measure(metric, value, feature)
}
func (c *Client) Increment(metric string, value float64, feature *string) {
	c.batcher.Increment(metric, value, feature)
}
func (c *Client) Observe(metric string, value float64, feature *string) {
	c.batcher.Observe(metric, value, feature)
}

func (c *Client) Flush(ctx context.Context) error { return c.batcher.Flush(ctx, c.api) }

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
