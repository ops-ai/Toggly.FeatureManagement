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

    private function createProvider(bool $useSignedDefinitions): FeatureProvider
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
        $appKey = getenv('TOGGLY_SMOKE_APP_KEY_BACKEND');
        if (empty($appKey)) {
            $this->markTestSkipped('TOGGLY_SMOKE_APP_KEY_BACKEND is not set');
        }

        $client = new \WebSocket\Client("wss://definitions.toggly.io/{$appKey}/ws", [
            'timeout' => 10,
        ]);

        $message = $client->receive();
        $parsed = json_decode($message, true);

        $this->assertNotNull($parsed, 'Failed to parse WebSocket message as JSON');
        $this->assertContains($parsed['type'], ['definitions', 'evaluated'],
            'Message type should be definitions or evaluated');
        $this->assertArrayHasKey('timestamp', $parsed, 'Message should contain timestamp');

        $client->close();
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
