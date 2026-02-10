<?php

namespace Toggly\FeatureManagement\Tests\Unit\Laravel\Storage;

use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Toggly\FeatureManagement\Models\FeatureDefinition;
use Toggly\FeatureManagement\Models\JsonWebKey;
use Toggly\FeatureManagement\Models\JsonWebKeySet;
use Toggly\Laravel\Storage\LaravelCacheSnapshotProvider;

/**
 * Unit tests for LaravelCacheSnapshotProvider
 */
class LaravelCacheSnapshotProviderTest extends TestCase
{
    private CacheRepository&MockObject $cacheRepository;
    private CacheFactory&MockObject $cacheFactory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cacheRepository = $this->createMock(CacheRepository::class);
        $this->cacheFactory = $this->createMock(CacheFactory::class);
        $this->cacheFactory->method('store')->willReturn($this->cacheRepository);
    }

    public function testCanBeInstantiatedWithCacheRepository(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $this->assertInstanceOf(LaravelCacheSnapshotProvider::class, $provider);
    }

    public function testCanBeInstantiatedWithCacheFactory(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheFactory);

        $this->assertInstanceOf(LaravelCacheSnapshotProvider::class, $provider);
    }

    public function testCanBeInstantiatedWithCustomStore(): void
    {
        $this->cacheFactory->expects($this->once())
            ->method('store')
            ->with('redis');

        $provider = new LaravelCacheSnapshotProvider($this->cacheFactory, 'redis');

        $this->assertInstanceOf(LaravelCacheSnapshotProvider::class, $provider);
    }

    public function testSaveSnapshotWithTtl(): void
    {
        $provider = new LaravelCacheSnapshotProvider(
            $this->cacheRepository,
            null,
            'toggly',
            3600
        );

        $features = [
            new FeatureDefinition([
                'featureKey' => 'test-feature',
                'filters' => [],
                'metrics' => null,
                'securedFeature' => false,
                'requirementType' => 'Any',
            ]),
        ];

        $this->cacheRepository->expects($this->once())
            ->method('put')
            ->with(
                'toggly:features:snapshot',
                $this->callback(function ($data) {
                    return isset($data['features']) &&
                        is_array($data['features']) &&
                        count($data['features']) === 1 &&
                        $data['features'][0]['featureKey'] === 'test-feature' &&
                        $data['signature'] === 'test-sig' &&
                        $data['keyId'] === 'key-1' &&
                        $data['timestamp'] === 1234567890;
                }),
                3600
            );

        $provider->saveSnapshot($features, 'test-sig', 'key-1', 1234567890);
    }

    public function testSaveSnapshotForever(): void
    {
        $provider = new LaravelCacheSnapshotProvider(
            $this->cacheRepository,
            null,
            'toggly',
            null // Forever
        );

        $features = [
            new FeatureDefinition([
                'featureKey' => 'test-feature',
            ]),
        ];

        $this->cacheRepository->expects($this->once())
            ->method('forever')
            ->with(
                'toggly:features:snapshot',
                $this->isType('array')
            );

        $provider->saveSnapshot($features);
    }

    public function testGetFeaturesSnapshotReturnsNullWhenEmpty(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $this->cacheRepository->expects($this->once())
            ->method('get')
            ->with('toggly:features:snapshot')
            ->willReturn(null);

        $result = $provider->getFeaturesSnapshot();

        $this->assertNull($result['features']);
        $this->assertNull($result['signature']);
        $this->assertNull($result['keyId']);
        $this->assertNull($result['timestamp']);
    }

    public function testGetFeaturesSnapshotReturnsStoredData(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $cachedData = [
            'features' => [
                [
                    'featureKey' => 'feature-1',
                    'filters' => [],
                    'metrics' => null,
                    'securedFeature' => false,
                    'requirementType' => 'Any',
                ],
                [
                    'featureKey' => 'feature-2',
                    'filters' => [],
                    'metrics' => null,
                    'securedFeature' => true,
                    'requirementType' => 'All',
                ],
            ],
            'signature' => 'sig-123',
            'keyId' => 'key-456',
            'timestamp' => 9876543210,
        ];

        $this->cacheRepository->expects($this->once())
            ->method('get')
            ->with('toggly:features:snapshot')
            ->willReturn($cachedData);

        $result = $provider->getFeaturesSnapshot();

        $this->assertCount(2, $result['features']);
        $this->assertInstanceOf(FeatureDefinition::class, $result['features'][0]);
        $this->assertInstanceOf(FeatureDefinition::class, $result['features'][1]);
        $this->assertEquals('feature-1', $result['features'][0]->featureKey);
        $this->assertEquals('feature-2', $result['features'][1]->featureKey);
        $this->assertEquals('sig-123', $result['signature']);
        $this->assertEquals('key-456', $result['keyId']);
        $this->assertEquals(9876543210, $result['timestamp']);
    }

    public function testSaveJwkSnapshotWithTtl(): void
    {
        $provider = new LaravelCacheSnapshotProvider(
            $this->cacheRepository,
            null,
            'toggly',
            7200
        );

        $jwks = new JsonWebKeySet([
            'keys' => [
                [
                    'kty' => 'EC',
                    'use' => 'sig',
                    'kid' => 'key-1',
                    'crv' => 'P-256',
                    'x' => 'test-x',
                    'y' => 'test-y',
                    'alg' => 'ES256',
                ],
            ],
        ]);

        $this->cacheRepository->expects($this->once())
            ->method('put')
            ->with(
                'toggly:jwks:snapshot',
                $this->callback(function ($data) {
                    return isset($data['jwks']['keys']) &&
                        count($data['jwks']['keys']) === 1 &&
                        $data['jwks']['keys'][0]['kid'] === 'key-1' &&
                        $data['timestamp'] === 1234567890;
                }),
                7200
            );

        $provider->saveJwkSnapshot($jwks, 1234567890);
    }

    public function testSaveJwkSnapshotForever(): void
    {
        $provider = new LaravelCacheSnapshotProvider(
            $this->cacheRepository,
            null,
            'toggly',
            null
        );

        $jwks = new JsonWebKeySet(['keys' => []]);

        $this->cacheRepository->expects($this->once())
            ->method('forever')
            ->with(
                'toggly:jwks:snapshot',
                $this->isType('array')
            );

        $provider->saveJwkSnapshot($jwks, 1234567890);
    }

    public function testGetJwkSnapshotReturnsNullWhenEmpty(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $this->cacheRepository->expects($this->once())
            ->method('get')
            ->with('toggly:jwks:snapshot')
            ->willReturn(null);

        $result = $provider->getJwkSnapshot();

        $this->assertNull($result['jwks']);
        $this->assertNull($result['timestamp']);
    }

    public function testGetJwkSnapshotReturnsStoredData(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $cachedData = [
            'jwks' => [
                'keys' => [
                    [
                        'kty' => 'EC',
                        'use' => 'sig',
                        'kid' => 'key-123',
                        'crv' => 'P-256',
                        'x' => 'x-value',
                        'y' => 'y-value',
                        'alg' => 'ES256',
                    ],
                ],
            ],
            'timestamp' => 5555555555,
        ];

        $this->cacheRepository->expects($this->once())
            ->method('get')
            ->with('toggly:jwks:snapshot')
            ->willReturn($cachedData);

        $result = $provider->getJwkSnapshot();

        $this->assertInstanceOf(JsonWebKeySet::class, $result['jwks']);
        $this->assertCount(1, $result['jwks']->keys);
        $this->assertEquals('key-123', $result['jwks']->keys[0]->kid);
        $this->assertEquals(5555555555, $result['timestamp']);
    }

    public function testClearRemovesBothSnapshots(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $this->cacheRepository->expects($this->exactly(2))
            ->method('forget')
            ->willReturnCallback(function ($key) {
                $this->assertContains($key, [
                    'toggly:features:snapshot',
                    'toggly:jwks:snapshot',
                ]);
                return true;
            });

        $provider->clear();
    }

    public function testHasFeaturesSnapshot(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $this->cacheRepository->expects($this->once())
            ->method('has')
            ->with('toggly:features:snapshot')
            ->willReturn(true);

        $this->assertTrue($provider->hasFeaturesSnapshot());
    }

    public function testHasJwkSnapshot(): void
    {
        $provider = new LaravelCacheSnapshotProvider($this->cacheRepository);

        $this->cacheRepository->expects($this->once())
            ->method('has')
            ->with('toggly:jwks:snapshot')
            ->willReturn(false);

        $this->assertFalse($provider->hasJwkSnapshot());
    }

    public function testCustomPrefix(): void
    {
        $provider = new LaravelCacheSnapshotProvider(
            $this->cacheRepository,
            null,
            'custom-prefix'
        );

        $this->cacheRepository->expects($this->once())
            ->method('get')
            ->with('custom-prefix:features:snapshot')
            ->willReturn(null);

        $provider->getFeaturesSnapshot();
    }
}
