package metricspb

import (
	context "context"

	grpc "google.golang.org/grpc"
)

// MetricsClient is the client API for Metrics service.
type MetricsClient interface {
	SendMetrics(ctx context.Context, in *MetricStat, opts ...grpc.CallOption) (*MetricResult, error)
}

type metricsClient struct{ cc *grpc.ClientConn }

func NewMetricsClient(cc *grpc.ClientConn) MetricsClient { return &metricsClient{cc} }

func (c *metricsClient) SendMetrics(ctx context.Context, in *MetricStat, opts ...grpc.CallOption) (*MetricResult, error) {
	out := new(MetricResult)
	err := c.cc.Invoke(ctx, "/Metrics.Metrics/SendMetrics", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
