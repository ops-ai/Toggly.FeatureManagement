<?php

namespace Toggly\FeatureManagement\Tests\Unit\Models;

use PHPUnit\Framework\TestCase;
use Toggly\FeatureManagement\Models\FeatureDefinition;

/**
 * Test FeatureDefinition model
 */
class FeatureDefinitionTest extends TestCase
{
    public function testCanCreateFeatureDefinition(): void
    {
        $data = [
            'featureKey' => 'test-feature',
            'filters' => []
        ];

        $definition = new FeatureDefinition($data);

        $this->assertInstanceOf(FeatureDefinition::class, $definition);
        $this->assertEquals('test-feature', $definition->featureKey);
    }

    public function testFeatureDefinitionWithFilters(): void
    {
        $data = [
            'featureKey' => 'filtered-feature',
            'filters' => [
                ['name' => 'AlwaysOn', 'parameters' => []]
            ]
        ];

        $definition = new FeatureDefinition($data);

        $this->assertNotEmpty($definition->filters);
        $this->assertCount(1, $definition->filters);
    }

    public function testFeatureDefinitionSecuredFeature(): void
    {
        $data = [
            'featureKey' => 'secured-feature',
            'securedFeature' => true,
            'filters' => []
        ];

        $definition = new FeatureDefinition($data);

        $this->assertTrue($definition->securedFeature);
    }
}
