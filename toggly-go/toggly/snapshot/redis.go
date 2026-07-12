package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisProvider stores snapshots in Redis.
//
// Keys:
// - {prefix}:definitions
// - {prefix}:jwks
type RedisProvider struct {
	client *redis.Client
	prefix string
	ttl    time.Duration
}

// RedisOptions configures the RedisProvider.
type RedisOptions struct {
	// Client is the Redis client. Required.
	Client *redis.Client
	// Prefix for all keys. Default: "toggly".
	Prefix string
	// TTL for stored data. Zero means no expiration.
	TTL time.Duration
}

// NewRedisProvider creates a new Redis-based snapshot provider.
func NewRedisProvider(opts RedisOptions) *RedisProvider {
	prefix := opts.Prefix
	if prefix == "" {
		prefix = "toggly"
	}
	return &RedisProvider{
		client: opts.Client,
		prefix: prefix,
		ttl:    opts.TTL,
	}
}

func (r *RedisProvider) definitionsKey() string {
	return r.prefix + ":definitions"
}

func (r *RedisProvider) jwksKey() string {
	return r.prefix + ":jwks"
}

func (r *RedisProvider) LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error) {
	data, err := r.client.Get(ctx, r.definitionsKey()).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("redis get definitions: %w", err)
	}

	var snap DefinitionsSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, fmt.Errorf("decode definitions snapshot: %w", err)
	}
	return &snap, nil
}

func (r *RedisProvider) SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error {
	data, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("encode definitions snapshot: %w", err)
	}

	if err := r.client.Set(ctx, r.definitionsKey(), data, r.ttl).Err(); err != nil {
		return fmt.Errorf("redis set definitions: %w", err)
	}
	return nil
}

func (r *RedisProvider) Clear(ctx context.Context) error {
	if err := r.client.Del(ctx, r.definitionsKey(), r.jwksKey()).Err(); err != nil {
		return fmt.Errorf("redis clear snapshots: %w", err)
	}
	return nil
}

func (r *RedisProvider) LoadJWKS(ctx context.Context) (*JWKSnap, error) {
	data, err := r.client.Get(ctx, r.jwksKey()).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("redis get jwks: %w", err)
	}

	var wire struct {
		Set    json.RawMessage `json:"set"`
		Expiry int64           `json:"expiry"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return nil, fmt.Errorf("decode jwks snapshot: %w", err)
	}

	var snap JWKSnap
	if err := json.Unmarshal(wire.Set, &snap.Set); err != nil {
		return nil, fmt.Errorf("decode jwks set: %w", err)
	}
	snap.Expiry = time.Unix(wire.Expiry, 0)
	return &snap, nil
}

func (r *RedisProvider) SaveJWKS(ctx context.Context, snap JWKSnap) error {
	setBytes, err := json.Marshal(snap.Set)
	if err != nil {
		return fmt.Errorf("encode jwks set: %w", err)
	}

	wire := struct {
		Set    json.RawMessage `json:"set"`
		Expiry int64           `json:"expiry"`
	}{Set: setBytes, Expiry: snap.Expiry.Unix()}

	data, err := json.Marshal(wire)
	if err != nil {
		return fmt.Errorf("encode jwks snapshot: %w", err)
	}

	if err := r.client.Set(ctx, r.jwksKey(), data, r.ttl).Err(); err != nil {
		return fmt.Errorf("redis set jwks: %w", err)
	}
	return nil
}
