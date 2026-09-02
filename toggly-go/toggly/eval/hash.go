package eval

import (
	"crypto/sha256"
	"encoding/binary"
)

// ComputePercentile returns a sticky bucket in [0, 100) matching Definitions /
// toggly-eval: SHA-256 of featureKey + "\n" + userId, little-endian uint32
// from the first 4 bytes, then (value / 0xFFFFFFFF) * 100.
//
// Arg order matches the TS helper: ComputePercentile(userID, featureKey)
// while the hashed string is featureKey-first.
func ComputePercentile(userID, featureKey string) float64 {
	sum := sha256.Sum256([]byte(featureKey + "\n" + userID))
	value := binary.LittleEndian.Uint32(sum[:4])
	return (float64(value) / float64(0xFFFFFFFF)) * 100
}
