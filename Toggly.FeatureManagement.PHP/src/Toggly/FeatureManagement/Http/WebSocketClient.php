<?php

namespace Toggly\FeatureManagement\Http;

use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * WebSocket client for real-time feature updates
 * Falls back to polling if WebSocket is not available
 */
class WebSocketClient
{
    private ?string $url = null;
    private ?callable $onUpdate = null;
    private bool $isRunning = false;
    private LoggerInterface $logger;
    private bool $websocketAvailable = false;

    public function __construct(?LoggerInterface $logger = null)
    {
        $this->logger = $logger ?? new NullLogger();
        // Check if WebSocket support is available
        $this->websocketAvailable = extension_loaded('sockets') || class_exists(\React\Socket\Connector::class);
    }

    /**
     * Connect to WebSocket URL
     * @param string $url WebSocket URL
     * @param callable $onUpdate Callback to call when "update" message is received
     * @return bool True if connected, false if WebSocket not available (will fallback to polling)
     */
    public function connect(string $url, callable $onUpdate): bool
    {
        $this->url = $url;
        $this->onUpdate = $onUpdate;

        if (!$this->websocketAvailable) {
            $this->logger->info('WebSocket not available, will use polling instead');
            return false;
        }

        // Try to use ReactPHP if available
        if (class_exists(\React\Socket\Connector::class)) {
            return $this->connectWithReactPHP($url, $onUpdate);
        }

        // Fallback: WebSocket not available
        $this->logger->info('WebSocket libraries not available, will use polling instead');
        return false;
    }

    /**
     * Connect using ReactPHP
     */
    private function connectWithReactPHP(string $url, callable $onUpdate): bool
    {
        try {
            // This is a simplified version - in production, you'd use a proper WebSocket client
            // For now, we'll just mark it as not available and use polling
            $this->logger->info('ReactPHP WebSocket support would be implemented here');
            return false;
        } catch (\Exception $e) {
            $this->logger->error('Failed to connect WebSocket', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Disconnect from WebSocket
     */
    public function disconnect(): void
    {
        $this->isRunning = false;
        $this->url = null;
        $this->onUpdate = null;
    }

    /**
     * Check if WebSocket is running
     */
    public function isRunning(): bool
    {
        return $this->isRunning;
    }

    /**
     * Check if WebSocket support is available
     */
    public function isAvailable(): bool
    {
        return $this->websocketAvailable;
    }
}
