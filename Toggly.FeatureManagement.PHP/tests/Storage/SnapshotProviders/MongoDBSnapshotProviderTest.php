<?php

namespace Toggly\FeatureManagement\Tests\Storage\SnapshotProviders;

use MongoDB\Client;
use MongoDB\Collection;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;
use Toggly\FeatureManagement\Models\FeatureDefinition;
use Toggly\FeatureManagement\Models\FeatureFilter;
use Toggly\FeatureManagement\Models\JsonWebKey;
use Toggly\FeatureManagement\Models\JsonWebKeySet;
use Toggly\FeatureManagement\Storage\SnapshotProviders\MongoDBSnapshotProvider;
use Toggly\FeatureManagement\Contracts\FeatureSnapshotProviderInterface;

#[Group('integration')]
class MongoDBSnapshotProviderTest extends TestCase
{
    private ?Client $client = null;
    private ?Collection $collection = null;
    private ?MongoDBSnapshotProvider $provider = null;

    protected function setUp(): void
    {
        $uri = getenv('MONGO_TEST_URI') ?: 'mongodb://localhost:27017';
        
        try {
            $this->client = new Client($uri);
            // Test connection
            $this->client->listDatabases();
        } catch (\Exception $e) {
            $this->markTestSkipped("Cannot connect to MongoDB at {$uri}: " . $e->getMessage());
        }

        $this->collection = $this->client->selectDatabase('toggly_tests')->selectCollection('test_snapshots_' . uniqid());
        $this->provider = new MongoDBSnapshotProvider($this->collection);
    }

    protected function tearDown(): void
    {
        if ($this->collection) {
            $this->collection->drop();
        }
    }

    #[Test]
    public function implements_interface(): void
    {
        $this->assertInstanceOf(FeatureSnapshotProviderInterface::class, $this->provider);
    }

    #[Test]
    public function get_features_snapshot_when_empty_returns_nulls(): void
    {
        $result = $this->provider->getFeaturesSnapshot();

        $this->assertNull($result['features']);
        $this->assertNull($result['signature']);
        $this->assertNull($result['keyId']);
        $this->assertNull($result['timestamp']);
    }

    #[Test]
    public function save_and_get_features_snapshot(): void
    {
        $features = $this->createTestFeatures();
        $this->provider->saveSnapshot($features, 'test-signature', 'key-123', 1700000000);

        $result = $this->provider->getFeaturesSnapshot();

        $this->assertNotNull($result['features']);
        $this->assertCount(2, $result['features']);
        $this->assertEquals('feature1', $result['features'][0]->featureKey);
        $this->assertEquals('feature2', $result['features'][1]->featureKey);
        $this->assertEquals('test-signature', $result['signature']);
        $this->assertEquals('key-123', $result['keyId']);
        $this->assertEquals(1700000000, $result['timestamp']);
    }

    #[Test]
    public function save_snapshot_with_null_optional_parameters(): void
    {
        $features = $this->createTestFeatures();
        $this->provider->saveSnapshot($features);

        $result = $this->provider->getFeaturesSnapshot();

        $this->assertNotNull($result['features']);
        $this->assertNull($result['signature']);
        $this->assertNull($result['keyId']);
        $this->assertNull($result['timestamp']);
    }

    #[Test]
    public function save_snapshot_updates_existing_record(): void
    {
        $features1 = $this->createTestFeatures();
        $this->provider->saveSnapshot($features1, 'sig-1', 'kid-1', 1700000001);

        $features2 = [
            new FeatureDefinition(['featureKey' => 'updated-feature', 'filters' => []])
        ];
        $this->provider->saveSnapshot($features2, 'sig-2', 'kid-2', 1700000002);

        $result = $this->provider->getFeaturesSnapshot();

        $this->assertCount(1, $result['features']);
        $this->assertEquals('updated-feature', $result['features'][0]->featureKey);
        $this->assertEquals('sig-2', $result['signature']);
        $this->assertEquals('kid-2', $result['keyId']);
        $this->assertEquals(1700000002, $result['timestamp']);

        // Verify only one document exists
        $count = $this->collection->countDocuments(['_id' => 'toggly_features']);
        $this->assertEquals(1, $count);
    }

    #[Test]
    public function save_snapshot_with_empty_list(): void
    {
        $this->provider->saveSnapshot([]);

        $result = $this->provider->getFeaturesSnapshot();

        $this->assertNotNull($result['features']);
        $this->assertEmpty($result['features']);
    }

    #[Test]
    public function save_snapshot_with_complex_features(): void
    {
        $features = [
            new FeatureDefinition([
                'featureKey' => 'complex-feature',
                'securedFeature' => true,
                'requirementType' => 'All',
                'metrics' => ['metric1', 'metric2'],
                'filters' => [
                    new FeatureFilter(['name' => 'Percentage', 'parameters' => ['Value' => '50']])
                ]
            ])
        ];

        $this->provider->saveSnapshot($features);

        $result = $this->provider->getFeaturesSnapshot();

        $this->assertNotNull($result['features']);
        $this->assertEquals('complex-feature', $result['features'][0]->featureKey);
        $this->assertTrue($result['features'][0]->securedFeature);
        $this->assertEquals('All', $result['features'][0]->requirementType);
        $this->assertEquals(['metric1', 'metric2'], $result['features'][0]->metrics);
        $this->assertCount(1, $result['features'][0]->filters);
        $this->assertEquals('Percentage', $result['features'][0]->filters[0]->name);
        $this->assertEquals('50', $result['features'][0]->filters[0]->parameters['Value']);
    }

    #[Test]
    public function get_jwk_snapshot_when_empty_returns_nulls(): void
    {
        $result = $this->provider->getJwkSnapshot();

        $this->assertNull($result['jwks']);
        $this->assertNull($result['timestamp']);
    }

    #[Test]
    public function save_and_get_jwk_snapshot(): void
    {
        $jwks = $this->createTestJwks();
        $this->provider->saveJwkSnapshot($jwks, 1700000003);

        $result = $this->provider->getJwkSnapshot();

        $this->assertNotNull($result['jwks']);
        $this->assertCount(1, $result['jwks']->keys);
        $this->assertEquals('test-key-id', $result['jwks']->keys[0]->kid);
        $this->assertEquals(1700000003, $result['timestamp']);
    }

    #[Test]
    public function save_jwk_snapshot_updates_existing_record(): void
    {
        $jwks1 = $this->createTestJwks();
        $this->provider->saveJwkSnapshot($jwks1, 1700000001);

        $jwks2 = new JsonWebKeySet([
            'keys' => [
                new JsonWebKey(['kid' => 'updated-key-id', 'kty' => 'EC'])
            ]
        ]);
        $this->provider->saveJwkSnapshot($jwks2, 1700000002);

        $result = $this->provider->getJwkSnapshot();

        $this->assertEquals('updated-key-id', $result['jwks']->keys[0]->kid);
        $this->assertEquals(1700000002, $result['timestamp']);

        // Verify only one document exists
        $count = $this->collection->countDocuments(['_id' => 'toggly_jwks']);
        $this->assertEquals(1, $count);
    }

    #[Test]
    public function round_trip_features_and_jwks(): void
    {
        $features = $this->createTestFeatures();
        $jwks = $this->createTestJwks();

        $this->provider->saveSnapshot($features, 'sig', 'kid', 1700000000);
        $this->provider->saveJwkSnapshot($jwks, 1700000001);

        $featuresResult = $this->provider->getFeaturesSnapshot();
        $jwksResult = $this->provider->getJwkSnapshot();

        $this->assertCount(2, $featuresResult['features']);
        $this->assertCount(1, $jwksResult['jwks']->keys);
        $this->assertEquals('sig', $featuresResult['signature']);
        $this->assertEquals('kid', $featuresResult['keyId']);
        $this->assertEquals(1700000000, $featuresResult['timestamp']);
        $this->assertEquals(1700000001, $jwksResult['timestamp']);
    }

    #[Test]
    public function constructor_with_client_creates_collection(): void
    {
        $provider = new MongoDBSnapshotProvider(
            $this->client,
            'custom_db',
            'custom_collection',
            'custom_features',
            'custom_jwks'
        );

        $features = [new FeatureDefinition(['featureKey' => 'test', 'filters' => []])];
        $provider->saveSnapshot($features);

        $collection = $this->client->selectDatabase('custom_db')->selectCollection('custom_collection');
        $count = $collection->countDocuments(['_id' => 'custom_features']);
        
        $this->assertEquals(1, $count);

        // Cleanup
        $collection->drop();
    }

    #[Test]
    public function custom_document_ids(): void
    {
        $provider = new MongoDBSnapshotProvider(
            $this->collection,
            'db',
            'col',
            'my_features',
            'my_jwks'
        );

        $features = [new FeatureDefinition(['featureKey' => 'test', 'filters' => []])];
        $provider->saveSnapshot($features);

        $count = $this->collection->countDocuments(['_id' => 'my_features']);
        $this->assertEquals(1, $count);
    }

    #[Test]
    public function clear_removes_all_snapshots(): void
    {
        $features = $this->createTestFeatures();
        $jwks = $this->createTestJwks();

        $this->provider->saveSnapshot($features);
        $this->provider->saveJwkSnapshot($jwks, 1700000000);

        $this->provider->clear();

        $featuresResult = $this->provider->getFeaturesSnapshot();
        $jwksResult = $this->provider->getJwkSnapshot();

        $this->assertNull($featuresResult['features']);
        $this->assertNull($jwksResult['jwks']);
    }

    #[Test]
    public function has_features_snapshot_returns_false_when_empty(): void
    {
        $this->assertFalse($this->provider->hasFeaturesSnapshot());
    }

    #[Test]
    public function has_features_snapshot_returns_true_when_exists(): void
    {
        $this->provider->saveSnapshot($this->createTestFeatures());
        
        $this->assertTrue($this->provider->hasFeaturesSnapshot());
    }

    #[Test]
    public function has_jwk_snapshot_returns_false_when_empty(): void
    {
        $this->assertFalse($this->provider->hasJwkSnapshot());
    }

    #[Test]
    public function has_jwk_snapshot_returns_true_when_exists(): void
    {
        $this->provider->saveJwkSnapshot($this->createTestJwks(), 1700000000);
        
        $this->assertTrue($this->provider->hasJwkSnapshot());
    }

    #[Test]
    public function multiple_snapshots_independent_documents(): void
    {
        $features = $this->createTestFeatures();
        $jwks = $this->createTestJwks();

        $this->provider->saveSnapshot($features);
        $this->provider->saveJwkSnapshot($jwks, 1700000000);

        $allDocs = $this->collection->find()->toArray();
        
        $this->assertCount(2, $allDocs);
        
        $ids = array_map(fn($doc) => $doc['_id'], $allDocs);
        $this->assertContains('toggly_features', $ids);
        $this->assertContains('toggly_jwks', $ids);
    }

    /**
     * @return FeatureDefinition[]
     */
    private function createTestFeatures(): array
    {
        return [
            new FeatureDefinition([
                'featureKey' => 'feature1',
                'securedFeature' => false,
                'requirementType' => 'Any',
                'filters' => [
                    new FeatureFilter(['name' => 'AlwaysOn'])
                ]
            ]),
            new FeatureDefinition([
                'featureKey' => 'feature2',
                'securedFeature' => true,
                'requirementType' => 'All',
                'metrics' => ['impressions'],
                'filters' => [
                    new FeatureFilter(['name' => 'Percentage', 'parameters' => ['Value' => '25']])
                ]
            ])
        ];
    }

    private function createTestJwks(): JsonWebKeySet
    {
        return new JsonWebKeySet([
            'keys' => [
                new JsonWebKey([
                    'kid' => 'test-key-id',
                    'kty' => 'EC',
                    'crv' => 'P-256',
                    'x' => 'test-x-value',
                    'y' => 'test-y-value',
                    'use' => 'sig',
                    'alg' => 'ES256'
                ])
            ]
        ]);
    }
}
