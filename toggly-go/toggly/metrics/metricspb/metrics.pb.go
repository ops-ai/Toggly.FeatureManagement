// Code generated manually for Toggly Metrics.proto.
//
// This is a legacy-style protobuf definition compatible with grpc-go.
// If you prefer, you can regenerate from the upstream proto in your build.

package metricspb

import (
	"fmt"

	proto "github.com/golang/protobuf/proto"
	timestamp "github.com/golang/protobuf/ptypes/timestamp"
)

const _ = proto.ProtoPackageIsVersion3

type MetricStat struct {
	AppKey      string               `protobuf:"bytes,1,opt,name=appKey,proto3" json:"appKey,omitempty"`
	Environment string               `protobuf:"bytes,2,opt,name=environment,proto3" json:"environment,omitempty"`
	Time        *timestamp.Timestamp `protobuf:"bytes,3,opt,name=time,proto3" json:"time,omitempty"`
	Stats       []*MetricStatMessage `protobuf:"bytes,4,rep,name=stats,proto3" json:"stats,omitempty"`
	Counters    []*MetricCounterMessage `protobuf:"bytes,5,rep,name=counters,proto3" json:"counters,omitempty"`
	Observations []*MetricObservationMessage `protobuf:"bytes,6,rep,name=observations,proto3" json:"observations,omitempty"`
	InstanceName *string            `protobuf:"bytes,7,opt,name=instanceName,proto3,oneof" json:"instanceName,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *MetricStat) Reset()         { *m = MetricStat{} }
func (m *MetricStat) String() string { return proto.CompactTextString(m) }
func (*MetricStat) ProtoMessage()    {}
func (*MetricStat) Descriptor() ([]byte, []int) { return nil, []int{0} }

type MetricStatMessage struct {
	Metric        string   `protobuf:"bytes,1,opt,name=metric,proto3" json:"metric,omitempty"`
	Feature       *string  `protobuf:"bytes,4,opt,name=feature,proto3,oneof" json:"feature,omitempty"`
	Value         float64  `protobuf:"fixed64,5,opt,name=value,proto3" json:"value,omitempty"`
	ValueDisabled *float64 `protobuf:"fixed64,6,opt,name=valueDisabled,proto3,oneof" json:"valueDisabled,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *MetricStatMessage) Reset()         { *m = MetricStatMessage{} }
func (m *MetricStatMessage) String() string { return proto.CompactTextString(m) }
func (*MetricStatMessage) ProtoMessage()    {}
func (*MetricStatMessage) Descriptor() ([]byte, []int) { return nil, []int{1} }

type MetricCounterMessage struct {
	Metric        string   `protobuf:"bytes,1,opt,name=metric,proto3" json:"metric,omitempty"`
	Feature       *string  `protobuf:"bytes,4,opt,name=feature,proto3,oneof" json:"feature,omitempty"`
	Value         float64  `protobuf:"fixed64,5,opt,name=value,proto3" json:"value,omitempty"`
	ValueDisabled *float64 `protobuf:"fixed64,6,opt,name=valueDisabled,proto3,oneof" json:"valueDisabled,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *MetricCounterMessage) Reset()         { *m = MetricCounterMessage{} }
func (m *MetricCounterMessage) String() string { return proto.CompactTextString(m) }
func (*MetricCounterMessage) ProtoMessage()    {}
func (*MetricCounterMessage) Descriptor() ([]byte, []int) { return nil, []int{2} }

type MetricObservationMessage struct {
	Time          *timestamp.Timestamp `protobuf:"bytes,1,opt,name=time,proto3" json:"time,omitempty"`
	Metric        string               `protobuf:"bytes,2,opt,name=metric,proto3" json:"metric,omitempty"`
	Feature       *string              `protobuf:"bytes,5,opt,name=feature,proto3,oneof" json:"feature,omitempty"`
	Value         float64              `protobuf:"fixed64,6,opt,name=value,proto3" json:"value,omitempty"`
	ValueDisabled *float64             `protobuf:"fixed64,7,opt,name=valueDisabled,proto3,oneof" json:"valueDisabled,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *MetricObservationMessage) Reset()         { *m = MetricObservationMessage{} }
func (m *MetricObservationMessage) String() string { return proto.CompactTextString(m) }
func (*MetricObservationMessage) ProtoMessage()    {}
func (*MetricObservationMessage) Descriptor() ([]byte, []int) { return nil, []int{3} }

type MetricResult struct {
	Count int32 `protobuf:"varint,1,opt,name=count,proto3" json:"count,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *MetricResult) Reset()         { *m = MetricResult{} }
func (m *MetricResult) String() string { return proto.CompactTextString(m) }
func (*MetricResult) ProtoMessage()    {}
func (*MetricResult) Descriptor() ([]byte, []int) { return nil, []int{4} }

func init() {
	proto.RegisterType((*MetricStat)(nil), "Metrics.MetricStat")
	proto.RegisterType((*MetricStatMessage)(nil), "Metrics.MetricStatMessage")
	proto.RegisterType((*MetricCounterMessage)(nil), "Metrics.MetricCounterMessage")
	proto.RegisterType((*MetricObservationMessage)(nil), "Metrics.MetricObservationMessage")
	proto.RegisterType((*MetricResult)(nil), "Metrics.MetricResult")
}

func init() { _ = fmt.Sprintf }
