<?php

namespace Toggly\FeatureManagement\Storage\SnapshotProviders;

use MongoDB\Client;
use MongoDB\Collection;
use Toggly\FeatureManagement\Contracts\FeatureSnapshotProviderInterface;
use Toggly\FeatureManagement\Models\FeatureDefinition;
use Toggly\FeatureManagement\Models\JsonWebKeySet;

/**
 * MongoDB-based snapshot provider
 */
class MongoDBSnapshotProvider implements FeatureSnapshotProviderInterface
{
    private Collection $collection;
    private string $definitionsId;
    private string $jwksId;

    /**
     * Constructor
     *
     * @param Client|Collection $mongoClientOrCollection MongoDB client or collection instance
     * @param string $databaseName Database name (only used if Client is passed)
     * @param string $collectionName Collection name (only used if Client is passed)
     * @param string $definitionsId Document ID for feature definitions
     * @param string $jwksId Document ID for JWKs
     */
    public function __construct(
        Client|Collection $mongoClientOrCollection,
        string $databaseName = 'toggly',
        string $collectionName = 'snapshots',
        string $definitionsId = 'toggly_features',
        string $jwksId = 'toggly_jwks'
    ) {
        if ($mongoClientOrCollection instanceof Collection) {
            $this->collection = $mongoClientOrCollection;
        } else {
            $this->collection = $mongoClientOrCollection->selectDatabase($databaseName)->selectCollection($collectionName);
        }

        $this->definitionsId = $definitionsId;
        $this->jwksId = $jwksId;
    }

    /**
     * @inheritDoc
     */
    public function saveSnapshot(array $features, ?string $signature = null, ?string $keyId = null, ?int $timestamp = null): void
    {
        $featuresData = array_map(fn($f) => $f->toArray(), $features);

        $document = [
            '_id' => $this->definitionsId,
            'data' => json_encode($featuresData),
            'signature' => $signature,
            'keyId' => $keyId,
            'timestamp' => $timestamp,
            'updatedAt' => new \MongoDB\BSON\UTCDateTime(),
        ];

        $this->collection->replaceOne(
            ['_id' => $this->definitionsId],
            $document,
            ['upsert' => true]
        );
    }

    /**
     * @inheritDoc
     */
    public function getFeaturesSnapshot(): array
    {
        $document = $this->collection->findOne(['_id' => $this->definitionsId]);

        if ($document === null || empty($document['data'])) {
            return [
                'features' => null,
                'signature' => null,
                'keyId' => null,
                'timestamp' => null,
            ];
        }

        $features = [];
        $featuresData = json_decode($document['data'], true);
        if (is_array($featuresData)) {
            $features = array_map(function ($def) {
                return new FeatureDefinition($def);
            }, $featuresData);
        }

        return [
            'features' => $features,
            'signature' => $document['signature'] ?? null,
            'keyId' => $document['keyId'] ?? null,
            'timestamp' => $document['timestamp'] ?? null,
        ];
    }

    /**
     * @inheritDoc
     */
    public function saveJwkSnapshot(JsonWebKeySet $jwks, int $timestamp): void
    {
        $jwksData = [
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
        ];

        $document = [
            '_id' => $this->jwksId,
            'data' => json_encode($jwksData),
            'timestamp' => $timestamp,
            'updatedAt' => new \MongoDB\BSON\UTCDateTime(),
        ];

        $this->collection->replaceOne(
            ['_id' => $this->jwksId],
            $document,
            ['upsert' => true]
        );
    }

    /**
     * @inheritDoc
     */
    public function getJwkSnapshot(): array
    {
        $document = $this->collection->findOne(['_id' => $this->jwksId]);

        if ($document === null || empty($document['data'])) {
            return [
                'jwks' => null,
                'timestamp' => null,
            ];
        }

        $jwks = null;
        $jwksData = json_decode($document['data'], true);
        if (is_array($jwksData)) {
            $jwks = new JsonWebKeySet($jwksData);
        }

        return [
            'jwks' => $jwks,
            'timestamp' => $document['timestamp'] ?? null,
        ];
    }

    /**
     * Clear all snapshots
     */
    public function clear(): void
    {
        $this->collection->deleteOne(['_id' => $this->definitionsId]);
        $this->collection->deleteOne(['_id' => $this->jwksId]);
    }

    /**
     * Check if features snapshot exists
     */
    public function hasFeaturesSnapshot(): bool
    {
        return $this->collection->countDocuments(['_id' => $this->definitionsId]) > 0;
    }

    /**
     * Check if JWK snapshot exists
     */
    public function hasJwkSnapshot(): bool
    {
        return $this->collection->countDocuments(['_id' => $this->jwksId]) > 0;
    }
}
