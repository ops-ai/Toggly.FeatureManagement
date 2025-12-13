// Code generated manually for Toggly Usage.proto.
//
// This is a legacy-style protobuf definition compatible with grpc-go.
// If you prefer, you can regenerate from the upstream proto in your build.

package usagepb

import (
	"fmt"

	proto "github.com/golang/protobuf/proto"
	timestamp "github.com/golang/protobuf/ptypes/timestamp"
)

// Ensure compatibility with proto package.
const _ = proto.ProtoPackageIsVersion3

type FeatureStat struct {
	AppKey           string               `protobuf:"bytes,1,opt,name=appKey,proto3" json:"appKey,omitempty"`
	Environment      string               `protobuf:"bytes,2,opt,name=environment,proto3" json:"environment,omitempty"`
	Time             *timestamp.Timestamp `protobuf:"bytes,3,opt,name=time,proto3" json:"time,omitempty"`
	Stats            []*StatMessage        `protobuf:"bytes,4,rep,name=stats,proto3" json:"stats,omitempty"`
	TotalUniqueUsers int32                `protobuf:"varint,5,opt,name=totalUniqueUsers,proto3" json:"totalUniqueUsers,omitempty"`
	InstanceName     *string              `protobuf:"bytes,6,opt,name=instanceName,proto3,oneof" json:"instanceName,omitempty"`
	ProcessStartTime *timestamp.Timestamp `protobuf:"bytes,7,opt,name=processStartTime,proto3,oneof" json:"processStartTime,omitempty"`
	AppVersion       *string              `protobuf:"bytes,8,opt,name=appVersion,proto3,oneof" json:"appVersion,omitempty"`
	UniqueUserHashes []int32              `protobuf:"varint,9,rep,packed,name=uniqueUserHashes,proto3" json:"uniqueUserHashes,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *FeatureStat) Reset()         { *m = FeatureStat{} }
func (m *FeatureStat) String() string { return proto.CompactTextString(m) }
func (*FeatureStat) ProtoMessage()    {}
func (*FeatureStat) Descriptor() ([]byte, []int) {
	return nil, []int{0}
}

type StatMessage struct {
	Feature                          string  `protobuf:"bytes,1,opt,name=feature,proto3" json:"feature,omitempty"`
	EnabledCount                     int32   `protobuf:"varint,2,opt,name=enabledCount,proto3" json:"enabledCount,omitempty"`
	DisabledCount                    int32   `protobuf:"varint,3,opt,name=disabledCount,proto3" json:"disabledCount,omitempty"`
	UniqueContextIdentifierEnabledCount  int32 `protobuf:"varint,4,opt,name=uniqueContextIdentifierEnabledCount,proto3" json:"uniqueContextIdentifierEnabledCount,omitempty"`
	UniqueContextIdentifierDisabledCount int32 `protobuf:"varint,5,opt,name=uniqueContextIdentifierDisabledCount,proto3" json:"uniqueContextIdentifierDisabledCount,omitempty"`
	UniqueRequestEnabledCount        int32   `protobuf:"varint,6,opt,name=uniqueRequestEnabledCount,proto3" json:"uniqueRequestEnabledCount,omitempty"`
	UniqueRequestDisabledCount       int32   `protobuf:"varint,7,opt,name=uniqueRequestDisabledCount,proto3" json:"uniqueRequestDisabledCount,omitempty"`
	UsedCount                        int32   `protobuf:"varint,8,opt,name=usedCount,proto3" json:"usedCount,omitempty"`
	UniqueUsersUsedCount             int32   `protobuf:"varint,9,opt,name=uniqueUsersUsedCount,proto3" json:"uniqueUsersUsedCount,omitempty"`
	UniqueUserHashes                 []int32 `protobuf:"varint,10,rep,packed,name=uniqueUserHashes,proto3" json:"uniqueUserHashes,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *StatMessage) Reset()         { *m = StatMessage{} }
func (m *StatMessage) String() string { return proto.CompactTextString(m) }
func (*StatMessage) ProtoMessage()    {}
func (*StatMessage) Descriptor() ([]byte, []int) {
	return nil, []int{1}
}

type StatResult struct {
	FeatureCount int32 `protobuf:"varint,1,opt,name=featureCount,proto3" json:"featureCount,omitempty"`

	XXX_NoUnkeyedLiteral struct{} `json:"-"`
	XXX_unrecognized     []byte   `json:"-"`
	XXX_sizecache        int32    `json:"-"`
}

func (m *StatResult) Reset()         { *m = StatResult{} }
func (m *StatResult) String() string { return proto.CompactTextString(m) }
func (*StatResult) ProtoMessage()    {}
func (*StatResult) Descriptor() ([]byte, []int) {
	return nil, []int{2}
}

func init() {
	proto.RegisterType((*FeatureStat)(nil), "Usage.FeatureStat")
	proto.RegisterType((*StatMessage)(nil), "Usage.StatMessage")
	proto.RegisterType((*StatResult)(nil), "Usage.StatResult")
}

func init() { _ = fmt.Sprintf }
