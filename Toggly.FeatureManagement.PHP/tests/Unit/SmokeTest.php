<?php

namespace {
if (!function_exists('wp_remote_request')) {
    function wp_remote_request(string $url, array $args = []): array
    {
        $method = $args['method'] ?? 'GET';
        $headers = $args['headers'] ?? [];
        $body = $args['body'] ?? '';
        $timeout = (int)($args['timeout'] ?? 30);

        $headerLines = [];
        foreach ($headers as $name => $value) {
            $headerLines[] = $name . ': ' . $value;
        }

        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headerLines),
                'content' => $body,
                'timeout' => $timeout,
                'ignore_errors' => true,
            ],
        ]);

        $responseBody = @file_get_contents($url, false, $context);
        $meta = $http_response_header ?? [];

        $statusCode = 0;
        $statusMessage = '';
        $parsedHeaders = [];

        foreach ($meta as $index => $line) {
            if ($index === 0 && preg_match('/HTTP\/\d+\.\d+\s+(\d+)\s*(.*)/', $line, $matches)) {
                $statusCode = (int)$matches[1];
                $statusMessage = trim($matches[2]);
                continue;
            }

            $parts = explode(':', $line, 2);
            if (count($parts) === 2) {
                $name = trim($parts[0]);
                $value = trim($parts[1]);
                $parsedHeaders[$name] = $value;
            }
        }

        return [
            'response' => [
                'code' => $statusCode,
                'message' => $statusMessage,
            ],
            'headers' => $parsedHeaders,
            'body' => $responseBody === false ? '' : $responseBody,
        ];
    }
}

if (!function_exists('is_wp_error')) {
    function is_wp_error($thing): bool
    {
        return false;
    }
}

if (!function_exists('wp_remote_retrieve_response_code')) {
    function wp_remote_retrieve_response_code(array $response): int
    {
        return (int)($response['response']['code'] ?? 0);
    }
}

if (!function_exists('wp_remote_retrieve_response_message')) {
    function wp_remote_retrieve_response_message(array $response): string
    {
        return (string)($response['response']['message'] ?? '');
    }
}

if (!function_exists('wp_remote_retrieve_body')) {
    function wp_remote_retrieve_body(array $response): string
    {
        return (string)($response['body'] ?? '');
    }
}

if (!function_exists('wp_remote_retrieve_headers')) {
    function wp_remote_retrieve_headers(array $response): array
    {
        return (array)($response['headers'] ?? []);
    }
}
}

namespace Toggly\FeatureManagement\Tests\Unit {

use PHPUnit\Framework\TestCase;
use Toggly\FeatureManagement\Config\TogglySettings;
use Toggly\FeatureManagement\Core\FeatureProvider;
use Toggly\FeatureManagement\Core\FeatureStateService;
use Toggly\FeatureManagement\Http\TogglyHttpClient;
use Toggly\WordPress\Http\WordPressHttpClient;
use Toggly\WordPress\Http\WordPressRequestFactory;

class SmokeTest extends TestCase
{
    public function testSmokeUnsignedDefinitions(): void
    {
        $provider = $this->createProvider(false);
        $provider->refreshFeatures(true);

        $flagOn = $provider->getFeatureDefinition('FlagOn');
        $flagOff = $provider->getFeatureDefinition('FlagOff');

        $this->assertNotNull($flagOn);
        $this->assertNotNull($flagOff);
        $this->assertTrue($this->isAlwaysOn($flagOn));
        $this->assertFalse($this->isAlwaysOn($flagOff));
    }

    public function testSmokeSignedDefinitions(): void
    {
        $provider = $this->createProvider(true);
        $provider->refreshFeatures(true);

        $flagOn = $provider->getFeatureDefinition('FlagOn');
        $flagOff = $provider->getFeatureDefinition('FlagOff');

        $this->assertNotNull($flagOn);
        $this->assertNotNull($flagOff);
        $this->assertTrue($this->isAlwaysOn($flagOn));
        $this->assertFalse($this->isAlwaysOn($flagOff));
    }

    private function createProvider(bool $useSignedDefinitions, bool $enableLiveUpdates = false): FeatureProvider
    {
        $appKey = getenv('TOGGLY_SMOKE_APP_KEY_BACKEND');
        if (empty($appKey)) {
            $this->markTestSkipped('TOGGLY_SMOKE_APP_KEY_BACKEND is not set');
        }

        $settings = new TogglySettings([
            'app_key' => $appKey,
            'environment' => 'Production',
            'base_url' => 'https://definitions.toggly.io/',
            'use_signed_definitions' => $useSignedDefinitions,
            'refresh_interval' => 300,
            'enable_live_updates' => $enableLiveUpdates,
        ]);

        $httpClient = new TogglyHttpClient(
            new WordPressHttpClient(),
            new WordPressRequestFactory(),
            $settings->getBaseUrl()
        );

        return new FeatureProvider(
            $settings,
            $httpClient,
            new FeatureStateService()
        );
    }

    public function testSmokeWebSocketConnection(): void
    {
        $provider = $this->createProvider(false, true);
        $provider->refreshFeatures(true);

        $flagOn = $provider->getFeatureDefinition('FlagOn');
        $flagOff = $provider->getFeatureDefinition('FlagOff');

        $this->assertNotNull($flagOn, 'FlagOn should be defined');
        $this->assertNotNull($flagOff, 'FlagOff should be defined');
        $this->assertTrue($this->isAlwaysOn($flagOn), 'FlagOn should be AlwaysOn');
        $this->assertFalse($this->isAlwaysOn($flagOff), 'FlagOff should not be AlwaysOn');

        // Check if WebSocket connected via the SDK's built-in mechanism
        $debug = $provider->getDebugInfo();
        $this->assertTrue($debug['live_updates_enabled'], 'Live updates should be enabled');

        // If WebSocket is available in this environment, verify it connected
        if ($debug['websocket_available']) {
            $connected = false;
            for ($i = 0; $i < 30; $i++) {
                $provider->tick();
                $debug = $provider->getDebugInfo();
                if ($debug['websocket_running']) {
                    $connected = true;
                    break;
                }
                usleep(500_000);
            }

            $this->assertTrue($connected, 'SDK WebSocket should be running within 15 seconds');

            // Verify definitions still available after WebSocket connects
            $this->assertNotNull($provider->getFeatureDefinition('FlagOn'));
            $this->assertNotNull($provider->getFeatureDefinition('FlagOff'));
        }

        $provider->shutdown();
    }

    private function isAlwaysOn($featureDefinition): bool
    {
        foreach ($featureDefinition->filters as $filter) {
            if ($filter->name === 'AlwaysOn') {
                return true;
            }
        }

        return false;
    }
}
}
