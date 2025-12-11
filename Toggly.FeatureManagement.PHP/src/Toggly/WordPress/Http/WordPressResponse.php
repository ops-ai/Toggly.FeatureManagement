<?php

namespace Toggly\WordPress\Http;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\StreamInterface;

/**
 * WordPress response implementing PSR-7
 */
class WordPressResponse implements ResponseInterface
{
    private array $wpResponse;
    private int $statusCode;
    private string $reasonPhrase;
    private array $headers = [];
    private string $body;

    public function __construct(array $wpResponse)
    {
        $this->wpResponse = $wpResponse;
        $this->statusCode = wp_remote_retrieve_response_code($wpResponse);
        $this->reasonPhrase = wp_remote_retrieve_response_message($wpResponse);
        $this->body = wp_remote_retrieve_body($wpResponse);
        
        $headers = wp_remote_retrieve_headers($wpResponse);
        foreach ($headers as $name => $value) {
            $this->headers[strtolower($name)] = is_array($value) ? $value : [$value];
        }
    }

    public function getStatusCode(): int
    {
        return $this->statusCode;
    }

    public function withStatus($code, $reasonPhrase = ''): ResponseInterface
    {
        $new = clone $this;
        $new->statusCode = $code;
        $new->reasonPhrase = $reasonPhrase;
        return $new;
    }

    public function getReasonPhrase(): string
    {
        return $this->reasonPhrase;
    }

    public function getProtocolVersion(): string
    {
        return '1.1';
    }

    public function withProtocolVersion($version): ResponseInterface
    {
        return $this;
    }

    public function getHeaders(): array
    {
        return $this->headers;
    }

    public function hasHeader($name): bool
    {
        return isset($this->headers[strtolower($name)]);
    }

    public function getHeader($name): array
    {
        $name = strtolower($name);
        return $this->headers[$name] ?? [];
    }

    public function getHeaderLine($name): string
    {
        $header = $this->getHeader($name);
        return implode(', ', $header);
    }

    public function withHeader($name, $value): ResponseInterface
    {
        $new = clone $this;
        $new->headers[strtolower($name)] = is_array($value) ? $value : [$value];
        return $new;
    }

    public function withAddedHeader($name, $value): ResponseInterface
    {
        $new = clone $this;
        $name = strtolower($name);
        if (!isset($new->headers[$name])) {
            $new->headers[$name] = [];
        }
        $new->headers[$name] = array_merge($new->headers[$name], is_array($value) ? $value : [$value]);
        return $new;
    }

    public function withoutHeader($name): ResponseInterface
    {
        $new = clone $this;
        unset($new->headers[strtolower($name)]);
        return $new;
    }

    public function getBody(): StreamInterface
    {
        return new \Toggly\WordPress\Http\WordPressStream($this->body);
    }

    public function withBody(StreamInterface $body): ResponseInterface
    {
        $new = clone $this;
        $new->body = (string)$body;
        return $new;
    }
}
