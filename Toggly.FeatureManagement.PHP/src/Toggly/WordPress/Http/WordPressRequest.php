<?php

namespace Toggly\WordPress\Http;

use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\StreamInterface;
use Psr\Http\Message\UriInterface;

/**
 * WordPress request implementing PSR-7
 */
class WordPressRequest implements RequestInterface
{
    private string $method;
    private string $uri;
    private array $headers = [];
    private string $body = '';
    private string $protocolVersion = '1.1';

    public function __construct(string $method, $uri)
    {
        $this->method = $method;
        $this->uri = (string)$uri;
    }

    public function getRequestTarget(): string
    {
        return $this->uri;
    }

    public function withRequestTarget($requestTarget): RequestInterface
    {
        $new = clone $this;
        $new->uri = $requestTarget;
        return $new;
    }

    public function getMethod(): string
    {
        return $this->method;
    }

    public function withMethod($method): RequestInterface
    {
        $new = clone $this;
        $new->method = $method;
        return $new;
    }

    public function getUri(): UriInterface
    {
        return new \Toggly\WordPress\Http\WordPressUri($this->uri);
    }

    public function withUri(UriInterface $uri, $preserveHost = false): RequestInterface
    {
        $new = clone $this;
        $new->uri = (string)$uri;
        return $new;
    }

    public function getProtocolVersion(): string
    {
        return $this->protocolVersion;
    }

    public function withProtocolVersion($version): RequestInterface
    {
        $new = clone $this;
        $new->protocolVersion = $version;
        return $new;
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

    public function withHeader($name, $value): RequestInterface
    {
        $new = clone $this;
        $new->headers[strtolower($name)] = is_array($value) ? $value : [$value];
        return $new;
    }

    public function withAddedHeader($name, $value): RequestInterface
    {
        $new = clone $this;
        $name = strtolower($name);
        if (!isset($new->headers[$name])) {
            $new->headers[$name] = [];
        }
        $new->headers[$name] = array_merge($new->headers[$name], is_array($value) ? $value : [$value]);
        return $new;
    }

    public function withoutHeader($name): RequestInterface
    {
        $new = clone $this;
        unset($new->headers[strtolower($name)]);
        return $new;
    }

    public function getBody(): StreamInterface
    {
        return new \Toggly\WordPress\Http\WordPressStream($this->body);
    }

    public function withBody(StreamInterface $body): RequestInterface
    {
        $new = clone $this;
        $new->body = (string)$body;
        return $new;
    }
}
