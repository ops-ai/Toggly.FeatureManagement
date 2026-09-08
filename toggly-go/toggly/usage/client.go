package usage

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
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage/usagepb"
)

// Client wraps a gRPC Usage client and a batcher.
type Client struct {
	conn      *grpc.ClientConn
	api       usagepb.UsageClient
	batcher   *Batcher
	userAgent string
	flush     *autoflush.Controller
}

// Dial creates a gRPC usage client.
// userAgent is sent as gRPC metadata key "UA" on SendStats (matching .NET).
func Dial(baseURL, appKey, env, instance, appVersion, userAgent string) (*Client, error) {
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
		api:       usagepb.NewUsageClient(conn),
		batcher:   NewBatcher(appKey, env, instance, appVersion),
		userAgent: userAgent,
		flush:     autoflush.New(),
	}, nil
}

// Close stops auto-flush, waits for any in-flight ticker flush, then flushes
// pending stats (best-effort, ~15s timeout) and closes the connection.
func (c *Client) Close() error {
	if c.flush != nil {
		c.flush.StopAndWait()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = c.Flush(ctx)
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

// RecordView records a feature view (rendered/displayed).
func (c *Client) RecordView(feature string, identity string) {
	c.batcher.RecordView(feature, identity)
}

// RecordDefinitionCacheHit counts a definition-refresh served from local cache.
func (c *Client) RecordDefinitionCacheHit() {
	if c == nil || c.batcher == nil {
		return
	}
	c.batcher.RecordDefinitionCacheHit()
}

// RecordDefinitionCacheMiss counts a definition-refresh that applied a new revision.
func (c *Client) RecordDefinitionCacheMiss() {
	if c == nil || c.batcher == nil {
		return
	}
	c.batcher.RecordDefinitionCacheMiss()
}

// Flush sends accumulated stats with UA metadata.
// On SendStats failure the full batch (feature stats + hashes + cache counters)
// is restored and merged with any records accumulated during the in-flight send.
func (c *Client) Flush(ctx context.Context) error {
	// Hold a local reference so Close cannot drop restore after export.
	batcher := c.batcher
	api := c.api
	if batcher == nil || api == nil {
		return nil
	}
	if c.userAgent != "" {
		ctx = metadata.NewOutgoingContext(ctx, metadata.Pairs("UA", c.userAgent))
	}
	return batcher.Flush(ctx, api)
}

// StartAutoFlush flushes periodically.
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
