<?php

namespace Toggly\Laravel\Storage;

use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Toggly\FeatureManagement\Contracts\FeatureSnapshotProviderInterface;
use Toggly\FeatureManagement\Models\FeatureDefinition;
use Toggly\FeatureManagement\Models\JsonWebKeySet;

/**
 * Laravel Cache-based snapshot provider
 *
 * Uses Laravel's Cache facade/repository for storing feature snapshots.
 * Provides an idiomatic Laravel experience compared to the generic PSR-16 provider.
 */
class LaravelCacheSnapshotProvider implements FeatureSnapshotProviderInterface
{
    private CacheRepository $cache;
    private string $prefix;
    private ?int $ttl;

    /**
     * Create a new Laravel cache snapshot provider
     *
     * @param CacheFactory|CacheRepository $cache Cache factory or repository
     * @param string|null $store Cache store name (null = default store)
     * @param string $prefix Cache key prefix
     * @param int|null $ttl Cache TTL in seconds (null = forever)
     */
    public function __construct(
        CacheFactory|CacheRepository $cache,
        ?string $store = null,
        string $prefix = 'toggly',
        ?int $ttl = null
    ) {
        if ($cache instanceof CacheFactory) {
            $this->cache = $cache->store($store);
        } else {
            $this->cache = $cache;
        }

        $this->prefix = $prefix;
        $this->ttl = $ttl;
    }

    /**
     * Get the cache key for features snapshot
     */
    private function getFeaturesKey(): string
    {
        return $this->prefix . ':features:snapshot';
    }

    /**
     * Get the cache key for JWK snapshot
     */
    private function getJwkKey(): string
    {
        return $this->prefix . ':jwks:snapshot';
    }

    /**
     * @inheritDoc
     */
    public function saveSnapshot(array $features, ?string $signature = null, ?string $keyId = null, ?int $timestamp = null): void
    {
        $data = [
            'features' => array_map(fn($f) => $f->toArray(), $features),
            'signature' => $signature,
            'keyId' => $keyId,
            'timestamp' => $timestamp,
        ];

        if ($this->ttl === null) {
            $this->cache->forever($this->getFeaturesKey(), $data);
        } else {
            $this->cache->put($this->getFeaturesKey(), $data, $this->ttl);
        }
    }

    /**
     * @inheritDoc
     */
    public function getFeaturesSnapshot(): array
    {
        $data = $this->cache->get($this->getFeaturesKey());

        if ($data === null) {
            return [
                'features' => null,
                'signature' => null,
                'keyId' => null,
                'timestamp' => null,
            ];
        }

        $features = [];
        if (isset($data['features']) && is_array($data['features'])) {
            $features = array_map(function ($def) {
                return new FeatureDefinition($def);
            }, $data['features']);
        }

        return [
            'features' => $features,
            'signature' => $data['signature'] ?? null,
            'keyId' => $data['keyId'] ?? null,
            'timestamp' => $data['timestamp'] ?? null,
        ];
    }

    /**
     * @inheritDoc
     */
    public function saveJwkSnapshot(JsonWebKeySet $jwks, int $timestamp): void
    {
        $data = [
            'jwks' => [
                'keys' => array_map(function ($jwk) {
                    return [
                        'kty' => $jwk->kty,
                        'use' => $jwk->use,
                        'kid' => $jwk->kid,
                        'crv' => $jwk->crv,
                        'x' => $jwk->x,
                        'y' => $jwk->y,
                        'alg' => $jwk->alg,
                    ];
                }, $jwks->keys),
            ],
            'timestamp' => $timestamp,
        ];

        if ($this->ttl === null) {
            $this->cache->forever($this->getJwkKey(), $data);
        } else {
            $this->cache->put($this->getJwkKey(), $data, $this->ttl);
        }
    }

    /**
     * @inheritDoc
     */
    public function getJwkSnapshot(): array
    {
        $data = $this->cache->get($this->getJwkKey());

        if ($data === null) {
            return [
                'jwks' => null,
                'timestamp' => null,
            ];
        }

        $jwks = null;
        if (isset($data['jwks'])) {
            $jwks = new JsonWebKeySet($data['jwks']);
        }

        return [
            'jwks' => $jwks,
            'timestamp' => $data['timestamp'] ?? null,
        ];
    }

    /**
     * Clear all cached snapshots
     */
    public function clear(): void
    {
        $this->cache->forget($this->getFeaturesKey());
        $this->cache->forget($this->getJwkKey());
    }

    /**
     * Check if a features snapshot exists
     */
    public function hasFeaturesSnapshot(): bool
    {
        return $this->cache->has($this->getFeaturesKey());
    }

    /**
     * Check if a JWK snapshot exists
     */
    public function hasJwkSnapshot(): bool
    {
        return $this->cache->has($this->getJwkKey());
    }
}
