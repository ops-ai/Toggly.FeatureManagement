<?php

namespace Toggly\FeatureManagement\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Toggly\FeatureManagement\Core\FeatureManager;
use Toggly\FeatureManagement\Config\TogglySettings;

/**
 * Basic test for FeatureManager functionality
 */
class FeatureManagerTest extends TestCase
{
    public function testFeatureManagerCanBeInstantiated(): void
    {
        $settings = new TogglySettings('test-app-key', 'test-environment');
        $manager = new FeatureManager($settings);
        
        $this->assertInstanceOf(FeatureManager::class, $manager);
    }

    public function testSettingsAreStoredCorrectly(): void
    {
        $appKey = 'test-app-key-123';
        $environment = 'production';
        $settings = new TogglySettings($appKey, $environment);
        
        $this->assertEquals($appKey, $settings->getAppKey());
        $this->assertEquals($environment, $settings->getEnvironment());
    }

    public function testSettingsHaveDefaultValues(): void
    {
        $settings = new TogglySettings('app-key', 'env');
        
        $this->assertNotNull($settings->getDefinitionsUrl());
        $this->assertIsString($settings->getDefinitionsUrl());
    }
}
