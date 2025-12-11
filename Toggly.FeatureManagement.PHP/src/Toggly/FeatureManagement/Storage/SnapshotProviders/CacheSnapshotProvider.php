<?php

namespace Toggly\FeatureManagement\Storage\SnapshotProviders;

use Psr\SimpleCache\CacheInterface;
use Toggly\FeatureManagement\Contracts\FeatureSnapshotProviderInterface;
use Toggly\FeatureManagement\Models\FeatureDefinition;
use Toggly\FeatureManagement\Models\JsonWebKeySet;
use Toggly\FeatureManagement\Storage\SnapshotSettings;

/**
 * Cache-based snapshot provider using PSR-16 cache
 */
class CacheSnapshotProvider implements FeatureSnapshotProviderInterface
{
    private CacheInterface $cache;
    private SnapshotSettings $settings;
    private int $ttl;

    public function __construct(
        CacheInterface $cache,
        SnapshotSettings $settings,
        int $ttl = 86400 // 24 hours
    ) {
        $this->cache = $cache;
        $this->settings = $settings;
        $this->ttl = $ttl;
    }

    /**
     * @inheritDoc
     */
    public function saveSnapshot(array $features, ?string $signature = null, ?string $keyId = null, ?int $timestamp = null): void
    {
        $key = $this->settings->documentName ?? 'toggly:features:snapshot';
        
        $data = [
            'features' => array_map(fn($f) => $f->toArray(), $features),
            'signature' => $signature,
            'keyId' => $keyId,
            'timestamp' => $timestamp,
        ];

        $this->cache->set($key, $data, $this->ttl);
    }

    /**
     * @inheritDoc
     */
    public function getFeaturesSnapshot(): array
    {
        $key = $this->settings->documentName ?? 'toggly:features:snapshot';
        $data = $this->cache->get($key);

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
        $key = $this->settings->jwkDocumentName ?? 'toggly:jwks:snapshot';
        
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

        $this->cache->set($key, $data, $this->ttl);
    }

    /**
     * @inheritDoc
     */
    public function getJwkSnapshot(): array
    {
        $key = $this->settings->jwkDocumentName ?? 'toggly:jwks:snapshot';
        $data = $this->cache->get($key);

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
}
