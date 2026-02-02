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
            'enabled' => true,
            'requiresContext' => false,
            'filters' => []
        ];

        $definition = FeatureDefinition::fromArray($data);
        
        $this->assertInstanceOf(FeatureDefinition::class, $definition);
        $this->assertEquals('test-feature', $definition->getFeatureKey());
        $this->assertTrue($definition->isEnabled());
    }

    public function testFeatureDefinitionWithFilters(): void
    {
        $data = [
            'featureKey' => 'filtered-feature',
            'enabled' => true,
            'requiresContext' => true,
            'filters' => [
                ['type' => 'UserClaims', 'settings' => ['role' => 'admin']]
            ]
        ];

        $definition = FeatureDefinition::fromArray($data);
        
        $this->assertTrue($definition->requiresContext());
        $this->assertNotEmpty($definition->getFilters());
        $this->assertCount(1, $definition->getFilters());
    }

    public function testDisabledFeature(): void
    {
        $data = [
            'featureKey' => 'disabled-feature',
            'enabled' => false,
            'requiresContext' => false,
            'filters' => []
        ];

        $definition = FeatureDefinition::fromArray($data);
        
        $this->assertFalse($definition->isEnabled());
    }
}
