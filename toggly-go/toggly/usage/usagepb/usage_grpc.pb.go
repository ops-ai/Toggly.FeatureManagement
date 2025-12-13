package usagepb

import (
	context "context"

	grpc "google.golang.org/grpc"
)

// UsageClient is the client API for Usage service.
type UsageClient interface {
	SendStats(ctx context.Context, in *FeatureStat, opts ...grpc.CallOption) (*StatResult, error)
}

type usageClient struct{ cc *grpc.ClientConn }

func NewUsageClient(cc *grpc.ClientConn) UsageClient { return &usageClient{cc} }

func (c *usageClient) SendStats(ctx context.Context, in *FeatureStat, opts ...grpc.CallOption) (*StatResult, error) {
	out := new(StatResult)
	err := c.cc.Invoke(ctx, "/Usage.Usage/SendStats", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
