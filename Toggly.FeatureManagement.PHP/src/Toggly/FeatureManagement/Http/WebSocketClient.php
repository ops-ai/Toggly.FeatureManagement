<?php

namespace Toggly\FeatureManagement\Http;

use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * WebSocket client for real-time feature updates.
 *
 * Uses raw stream_socket_client with a manual WebSocket handshake so that no
 * external extension or library is required at runtime.
 *
 * WebSocket connections only make sense in long-running PHP processes (CLI,
 * Laravel Octane, ReactPHP, Swoole, etc.).  In traditional PHP-FPM / CGI
 * environments the connection attempt is skipped automatically.
 */
class WebSocketClient
{
    /** @var resource|null */
    private $socket = null;

    private ?string $url = null;

    /** @var callable|null */
    private $onUpdate = null;

    private bool $isRunning = false;

    private LoggerInterface $logger;

    private bool $longRunningProcess = false;

    /** Reconnect delay in seconds */
    private int $reconnectDelay = 5;

    /** @var int|null Timestamp of last reconnect attempt */
    private ?int $lastReconnectAttempt = null;

    public function __construct(?LoggerInterface $logger = null)
    {
        $this->logger = $logger ?? new NullLogger();
        $this->longRunningProcess = self::isLongRunningProcess();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Connect to WebSocket URL.
     *
     * @param string   $url      WebSocket URL (wss:// or ws://)
     * @param callable $onUpdate Callback invoked when a feature-update message arrives
     *
     * @return bool True if the connection was established
     */
    public function connect(string $url, callable $onUpdate): bool
    {
        $this->url = $url;
        $this->onUpdate = $onUpdate;

        if (!$this->longRunningProcess) {
            $this->logger->info('WebSocket skipped: not a long-running process (SAPI: ' . php_sapi_name() . ')');
            return false;
        }

        return $this->doConnect();
    }

    /**
     * Disconnect from WebSocket and clean up resources.
     */
    public function disconnect(): void
    {
        $this->closeSocket();
        $this->isRunning = false;
        $this->url = null;
        $this->onUpdate = null;
        $this->lastReconnectAttempt = null;
    }

    /**
     * Whether the WebSocket connection is currently active.
     */
    public function isRunning(): bool
    {
        return $this->isRunning;
    }

    /**
     * Whether live-update support is available in the current runtime.
     */
    public function isAvailable(): bool
    {
        return $this->longRunningProcess;
    }

    /**
     * Non-blocking tick: read any pending WebSocket frames.
     *
     * Call this periodically (e.g. every loop iteration) in a long-running
     * process so that incoming messages are consumed.  If the connection
     * dropped it will schedule a reconnect.
     */
    public function tick(): void
    {
        if (!$this->isRunning || $this->socket === null) {
            $this->maybeReconnect();
            return;
        }

        // Non-blocking read
        $read = [$this->socket];
        $write = $except = [];
        $changed = @stream_select($read, $write, $except, 0, 0);

        if ($changed === false) {
            // stream_select error – connection probably gone
            $this->handleDisconnect();
            return;
        }

        if ($changed === 0) {
            return; // nothing to read
        }

        $data = $this->readFrame();

        if ($data === null) {
            // Connection closed by server
            $this->handleDisconnect();
            return;
        }

        if ($data === '') {
            return; // incomplete frame, try again next tick
        }

        $this->handleMessage($data);
    }

    // ------------------------------------------------------------------
    // Connection internals
    // ------------------------------------------------------------------

    /**
     * Perform the actual TCP + WebSocket handshake.
     */
    private function doConnect(): bool
    {
        try {
            $parsed = $this->parseWsUrl($this->url);
            if ($parsed === null) {
                $this->logger->error('WebSocket: invalid URL: ' . $this->url);
                return false;
            }

            $scheme = $parsed['scheme'];
            $host   = $parsed['host'];
            $port   = $parsed['port'];
            $path   = $parsed['path'];

            $transport = ($scheme === 'wss') ? 'ssl' : 'tcp';
            $remote    = "{$transport}://{$host}:{$port}";

            $context = stream_context_create();
            if ($transport === 'ssl') {
                stream_context_set_option($context, 'ssl', 'verify_peer', true);
                stream_context_set_option($context, 'ssl', 'verify_peer_name', true);
            }

            $errno  = 0;
            $errstr = '';
            $socket = @stream_socket_client(
                $remote,
                $errno,
                $errstr,
                5, // connect timeout seconds
                STREAM_CLIENT_CONNECT,
                $context
            );

            if ($socket === false) {
                $this->logger->error("WebSocket: TCP connect failed ({$errno}): {$errstr}");
                return false;
            }

            stream_set_timeout($socket, 5);

            // --- WebSocket upgrade handshake (RFC 6455) ---
            $key = base64_encode(random_bytes(16));

            $headers  = "GET {$path} HTTP/1.1\r\n";
            $headers .= "Host: {$host}\r\n";
            $headers .= "Upgrade: websocket\r\n";
            $headers .= "Connection: Upgrade\r\n";
            $headers .= "Sec-WebSocket-Key: {$key}\r\n";
            $headers .= "Sec-WebSocket-Version: 13\r\n";
            $headers .= "\r\n";

            fwrite($socket, $headers);

            $response = '';
            while (($line = fgets($socket)) !== false) {
                $response .= $line;
                if ($line === "\r\n") {
                    break;
                }
            }

            if (strpos($response, '101') === false) {
                $this->logger->error('WebSocket: handshake failed: ' . trim(strtok($response, "\r\n")));
                fclose($socket);
                return false;
            }

            // Switch to non-blocking for tick() usage
            stream_set_blocking($socket, false);

            $this->socket    = $socket;
            $this->isRunning = true;
            $this->lastReconnectAttempt = null;

            $this->logger->info('WebSocket connected to ' . $this->url);
            return true;
        } catch (\Exception $e) {
            $this->logger->error('WebSocket: connect error: ' . $e->getMessage());
            $this->closeSocket();
            return false;
        }
    }

    /**
     * Handle a disconnect: close socket and prepare for reconnect.
     */
    private function handleDisconnect(): void
    {
        $this->logger->debug('WebSocket disconnected, will reconnect in ' . $this->reconnectDelay . 's');
        $this->closeSocket();
        $this->isRunning = false;
        $this->lastReconnectAttempt = time();
    }

    /**
     * Attempt reconnection if enough time has passed since the last attempt.
     */
    private function maybeReconnect(): void
    {
        if ($this->url === null || $this->onUpdate === null) {
            return;
        }

        if ($this->lastReconnectAttempt !== null && (time() - $this->lastReconnectAttempt) < $this->reconnectDelay) {
            return;
        }

        $this->lastReconnectAttempt = time();
        $this->logger->debug('WebSocket: attempting reconnect');
        $this->doConnect();
    }

    /**
     * Close the underlying socket resource.
     */
    private function closeSocket(): void
    {
        if ($this->socket !== null) {
            // Send a close frame (opcode 0x8) best-effort
            $this->sendCloseFrame();
            @fclose($this->socket);
            $this->socket = null;
        }
    }

    // ------------------------------------------------------------------
    // WebSocket frame reading / writing (RFC 6455)
    // ------------------------------------------------------------------

    /**
     * Read a single WebSocket frame and return its payload.
     *
     * Returns null on connection close, empty string on incomplete data.
     */
    private function readFrame(): ?string
    {
        $header = @fread($this->socket, 2);
        if ($header === false || strlen($header) < 2) {
            if (feof($this->socket)) {
                return null;
            }
            return '';
        }

        $byte1  = ord($header[0]);
        $byte2  = ord($header[1]);
        $opcode = $byte1 & 0x0F;
        $masked = ($byte2 & 0x80) !== 0;
        $len    = $byte2 & 0x7F;

        if ($len === 126) {
            $ext = @fread($this->socket, 2);
            if ($ext === false || strlen($ext) < 2) {
                return '';
            }
            $len = unpack('n', $ext)[1];
        } elseif ($len === 127) {
            $ext = @fread($this->socket, 8);
            if ($ext === false || strlen($ext) < 8) {
                return '';
            }
            $len = unpack('J', $ext)[1];
        }

        $maskKey = '';
        if ($masked) {
            $maskKey = @fread($this->socket, 4);
            if ($maskKey === false || strlen($maskKey) < 4) {
                return '';
            }
        }

        $payload = '';
        $remaining = $len;
        while ($remaining > 0) {
            $chunk = @fread($this->socket, $remaining);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $payload .= $chunk;
            $remaining -= strlen($chunk);
        }

        if ($masked && $maskKey !== '') {
            for ($i = 0; $i < strlen($payload); $i++) {
                $payload[$i] = chr(ord($payload[$i]) ^ ord($maskKey[$i % 4]));
            }
        }

        // Handle control frames
        if ($opcode === 0x8) {
            // Close frame
            return null;
        }

        if ($opcode === 0x9) {
            // Ping – reply with pong
            $this->sendFrame($payload, 0xA);
            return '';
        }

        if ($opcode === 0xA) {
            // Pong – ignore
            return '';
        }

        return $payload;
    }

    /**
     * Send a WebSocket frame (client frames are always masked per RFC 6455).
     */
    private function sendFrame(string $payload, int $opcode = 0x1): void
    {
        if ($this->socket === null) {
            return;
        }

        $frame = chr(0x80 | $opcode); // FIN + opcode

        $len = strlen($payload);
        if ($len < 126) {
            $frame .= chr(0x80 | $len); // MASK bit set
        } elseif ($len < 65536) {
            $frame .= chr(0x80 | 126) . pack('n', $len);
        } else {
            $frame .= chr(0x80 | 127) . pack('J', $len);
        }

        // Masking key
        $mask = random_bytes(4);
        $frame .= $mask;

        for ($i = 0; $i < $len; $i++) {
            $frame .= chr(ord($payload[$i]) ^ ord($mask[$i % 4]));
        }

        @fwrite($this->socket, $frame);
    }

    /**
     * Send a WebSocket close frame.
     */
    private function sendCloseFrame(): void
    {
        $this->sendFrame(pack('n', 1000), 0x8); // 1000 = normal closure
    }

    // ------------------------------------------------------------------
    // Message handling
    // ------------------------------------------------------------------

    /**
     * Parse an incoming WebSocket text message and invoke the update callback
     * when appropriate.
     */
    private function handleMessage(string $data): void
    {
        $data = trim($data);

        if ($data === '') {
            return;
        }

        // Try to parse as JSON first
        $decoded = @json_decode($data, true);

        if (is_array($decoded) && isset($decoded['type'])) {
            $type = $decoded['type'];

            if ($type === 'ping') {
                $this->logger->debug('WebSocket: received ping');
                return;
            }

            if ($type === 'flags-updated' || $type === 'update') {
                $this->logger->debug('WebSocket: definitions updated, triggering refresh');
                $this->invokeCallback();
                return;
            }

            $this->logger->debug('WebSocket: unknown message type: ' . $type);
            return;
        }

        // Plain-text signals (non-JSON)
        if ($data === 'update' || $data === 'flags-updated') {
            $this->logger->debug('WebSocket: plain-text update signal received');
            $this->invokeCallback();
            return;
        }

        $this->logger->debug('WebSocket: unrecognised message: ' . substr($data, 0, 200));
    }

    /**
     * Safely invoke the onUpdate callback.
     */
    private function invokeCallback(): void
    {
        if ($this->onUpdate === null) {
            return;
        }

        try {
            ($this->onUpdate)();
        } catch (\Exception $e) {
            $this->logger->error('WebSocket: update callback error: ' . $e->getMessage());
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Parse a ws:// or wss:// URL into components.
     *
     * @return array{scheme:string,host:string,port:int,path:string}|null
     */
    private function parseWsUrl(string $url): ?array
    {
        // Convert ws(s):// to http(s):// so parse_url can handle it
        $httpUrl = preg_replace('/^wss:\/\//', 'https://', $url);
        $httpUrl = preg_replace('/^ws:\/\//', 'http://', $httpUrl);

        $parts = parse_url($httpUrl);
        if ($parts === false || !isset($parts['host'])) {
            return null;
        }

        $scheme = str_starts_with($url, 'wss://') ? 'wss' : 'ws';
        $port   = $parts['port'] ?? ($scheme === 'wss' ? 443 : 80);
        $path   = $parts['path'] ?? '/';
        if (isset($parts['query'])) {
            $path .= '?' . $parts['query'];
        }

        return [
            'scheme' => $scheme,
            'host'   => $parts['host'],
            'port'   => $port,
            'path'   => $path,
        ];
    }

    /**
     * Detect whether the current PHP process is long-running.
     *
     * Traditional PHP-FPM / CGI / Apache mod_php requests die after each
     * request, so a WebSocket connection would be pointless.
     */
    private static function isLongRunningProcess(): bool
    {
        $sapi = php_sapi_name();

        // CLI is typically long-running (workers, queue consumers, artisan commands)
        if ($sapi === 'cli' || $sapi === 'cli-server' || $sapi === 'micro') {
            return true;
        }

        // Swoole / OpenSwoole / RoadRunner / FrankenPHP expose custom SAPIs
        if (str_contains($sapi, 'swoole')
            || str_contains($sapi, 'openswoole')
            || str_contains($sapi, 'roadrunner')
            || str_contains($sapi, 'frankenphp')
        ) {
            return true;
        }

        // Laravel Octane sets a well-known env var or constant
        if (defined('LARAVEL_OCTANE') || getenv('LARAVEL_OCTANE') !== false) {
            return true;
        }

        // ReactPHP is typically used from CLI but just in case
        if (class_exists(\React\EventLoop\Loop::class, false)) {
            return true;
        }

        // Everything else (fpm-fcgi, apache2handler, cgi, litespeed, etc.)
        return false;
    }
}
