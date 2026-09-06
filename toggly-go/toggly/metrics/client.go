package metrics

import (
	"context"
	"crypto/tls"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/autoflush"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/metricspb"
)

// Client wraps a gRPC Metrics client and a batcher.
type Client struct {
	conn      *grpc.ClientConn
	api       metricspb.MetricsClient
	batcher   *Batcher
	userAgent string
	flush     *autoflush.Controller
}

// Dial creates a gRPC metrics client.
// userAgent is sent as gRPC metadata key "UA" on SendMetrics (matching .NET).
func Dial(baseURL, appKey, env, instance, userAgent string) (*Client, error) {
	target, err := grpcTarget(baseURL)
	if err != nil {
		return nil, err
	}
	creds := credentials.NewTLS(&tls.Config{})
	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, err
	}
	return &Client{
		conn:      conn,
		api:       metricspb.NewMetricsClient(conn),
		batcher:   NewBatcher(appKey, env, instance),
		userAgent: userAgent,
		flush:     autoflush.New(),
	}, nil
}

// Close stops auto-flush, waits for any in-flight ticker flush, then flushes
// pending metrics (best-effort, ~15s timeout) and closes the connection.
func (c *Client) Close() error {
	if c.flush != nil {
		c.flush.StopAndWait()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = c.Flush(ctx)
	return c.conn.Close()
}

// Measure records a measurement. Empty variant defaults to "enabled".
func (c *Client) Measure(metric string, value float64, feature *string, variant string) {
	c.batcher.Measure(metric, value, feature, variant)
}

// Increment records a counter. Empty variant defaults to "enabled".
func (c *Client) Increment(metric string, value float64, feature *string, variant string) {
	c.batcher.Increment(metric, value, feature, variant)
}

// Observe records a point-in-time observation. Empty variant defaults to "enabled".
func (c *Client) Observe(metric string, value float64, feature *string, variant string) {
	c.batcher.Observe(metric, value, feature, variant)
}

func (c *Client) Flush(ctx context.Context) error {
	if c.userAgent != "" {
		ctx = metadata.NewOutgoingContext(ctx, metadata.Pairs("UA", c.userAgent))
	}
	return c.batcher.Flush(ctx, c.api)
}

func (c *Client) StartAutoFlush(interval time.Duration) {
	if c.flush == nil {
		c.flush = autoflush.New()
	}
	c.flush.Start(interval, c.Flush)
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
