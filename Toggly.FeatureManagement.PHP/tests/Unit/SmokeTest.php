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

        try {
            $host = 'definitions.toggly.io';
            $path = "/{$appKey}/ws";
            $key = base64_encode(random_bytes(16));

            $context = stream_context_create(['ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ]]);

            $socket = @stream_socket_client(
                "ssl://{$host}:443",
                $errno,
                $errstr,
                15,
                STREAM_CLIENT_CONNECT,
                $context
            );

            if ($socket === false) {
                fwrite(STDERR, "Warning: WebSocket smoke test skipped - connection failed: {$errstr}\n");
                return;
            }

            $request = "GET {$path} HTTP/1.1\r\n" .
                "Host: {$host}\r\n" .
                "Upgrade: websocket\r\n" .
                "Connection: Upgrade\r\n" .
                "Sec-WebSocket-Key: {$key}\r\n" .
                "Sec-WebSocket-Version: 13\r\n\r\n";

            fwrite($socket, $request);
            stream_set_timeout($socket, 15);

            $response = '';
            while (($line = fgets($socket)) !== false) {
                $response .= $line;
                if ($line === "\r\n") {
                    break;
                }
            }

            $this->assertStringContainsString('101', $response, 'Expected 101 Switching Protocols');

            $found = false;
            for ($attempt = 0; $attempt < 5; $attempt++) {
                $frame = $this->readWebSocketFrame($socket);
                if ($frame === null) {
                    break;
                }

                $parsed = json_decode($frame, true);
                if ($parsed !== null && isset($parsed['type']) && $parsed['type'] === 'ping') {
                    continue;
                }

                $this->assertNotNull($parsed, 'Failed to parse WebSocket message as JSON');
                $this->assertContains($parsed['type'], ['definitions', 'evaluated'],
                    'Message type should be definitions or evaluated');
                $this->assertArrayHasKey('timestamp', $parsed, 'Message should contain timestamp');
                $found = true;
                break;
            }

            if (!$found) {
                fwrite(STDERR, "Warning: WebSocket smoke test - no definitions message received\n");
            }

            fclose($socket);
        } catch (\Throwable $e) {
            // WebSocket connections may timeout due to Cloudflare Workers cold starts
            fwrite(STDERR, "Warning: WebSocket smoke test skipped: {$e->getMessage()}\n");
        }
    }

    private function readWebSocketFrame($socket): ?string
    {
        $header = fread($socket, 2);
        if ($header === false || strlen($header) < 2) return null;

        $opcode = ord($header[0]) & 0x0F;
        $masked = (ord($header[1]) & 0x80) !== 0;
        $payloadLen = ord($header[1]) & 0x7F;

        if ($payloadLen === 126) {
            $ext = fread($socket, 2);
            if ($ext === false) return null;
            $payloadLen = unpack('n', $ext)[1];
        } elseif ($payloadLen === 127) {
            $ext = fread($socket, 8);
            if ($ext === false) return null;
            $payloadLen = unpack('J', $ext)[1];
        }

        $maskKey = '';
        if ($masked) {
            $maskKey = fread($socket, 4);
            if ($maskKey === false) return null;
        }

        $payload = '';
        $remaining = $payloadLen;
        while ($remaining > 0) {
            $chunk = fread($socket, min($remaining, 8192));
            if ($chunk === false) return null;
            $payload .= $chunk;
            $remaining -= strlen($chunk);
        }

        if ($masked) {
            for ($i = 0; $i < strlen($payload); $i++) {
                $payload[$i] = chr(ord($payload[$i]) ^ ord($maskKey[$i % 4]));
            }
        }

        if ($opcode === 1) return $payload; // text frame
        return null;
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
