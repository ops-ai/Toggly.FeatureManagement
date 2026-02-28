<?php

namespace Toggly\FeatureManagement\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Toggly\FeatureManagement\Config\TogglySettings;

/**
 * Basic test for TogglySettings configuration
 */
class FeatureManagerTest extends TestCase
{
    public function testSettingsCanBeInstantiated(): void
    {
        $settings = new TogglySettings(['app_key' => 'test-app-key', 'environment' => 'Production']);

        $this->assertInstanceOf(TogglySettings::class, $settings);
    }

    public function testSettingsAreStoredCorrectly(): void
    {
        $appKey = 'test-app-key-123';
        $environment = 'Production';
        $settings = new TogglySettings(['app_key' => $appKey, 'environment' => $environment]);

        $this->assertEquals($appKey, $settings->appKey);
        $this->assertEquals($environment, $settings->environment);
    }

    public function testSettingsHaveDefaultValues(): void
    {
        $settings = new TogglySettings(['app_key' => 'app-key', 'environment' => 'Production']);

        $this->assertNotNull($settings->getBaseUrl());
        $this->assertIsString($settings->getBaseUrl());
    }
}
