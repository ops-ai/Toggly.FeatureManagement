<?php

namespace Toggly\WordPress\Http;

use Psr\Http\Message\UriInterface;

/**
 * Simple URI implementation for WordPress
 */
class WordPressUri implements UriInterface
{
    private string $uri;

    public function __construct(string $uri)
    {
        $this->uri = $uri;
    }

    public function getScheme(): string
    {
        return parse_url($this->uri, PHP_URL_SCHEME) ?? '';
    }

    public function getAuthority(): string
    {
        $host = $this->getHost();
        if (empty($host)) {
            return '';
        }

        $authority = $host;
        $port = $this->getPort();
        if ($port !== null) {
            $authority .= ':' . $port;
        }

        return $authority;
    }

    public function getUserInfo(): string
    {
        return '';
    }

    public function getHost(): string
    {
        return parse_url($this->uri, PHP_URL_HOST) ?? '';
    }

    public function getPort(): ?int
    {
        $port = parse_url($this->uri, PHP_URL_PORT);
        return $port !== null ? (int)$port : null;
    }

    public function getPath(): string
    {
        return parse_url($this->uri, PHP_URL_PATH) ?? '';
    }

    public function getQuery(): string
    {
        return parse_url($this->uri, PHP_URL_QUERY) ?? '';
    }

    public function getFragment(): string
    {
        return parse_url($this->uri, PHP_URL_FRAGMENT) ?? '';
    }

    public function withScheme($scheme): UriInterface
    {
        $new = clone $this;
        $new->uri = str_replace($this->getScheme() . '://', $scheme . '://', $this->uri);
        return $new;
    }

    public function withUserInfo($user, $password = null): UriInterface
    {
        return $this;
    }

    public function withHost($host): UriInterface
    {
        $new = clone $this;
        $parsed = parse_url($this->uri);
        $new->uri = ($parsed['scheme'] ?? 'http') . '://' . $host . ($parsed['path'] ?? '') . 
                   (isset($parsed['query']) ? '?' . $parsed['query'] : '') .
                   (isset($parsed['fragment']) ? '#' . $parsed['fragment'] : '');
        return $new;
    }

    public function withPort($port): UriInterface
    {
        return $this;
    }

    public function withPath($path): UriInterface
    {
        $new = clone $this;
        $parsed = parse_url($this->uri);
        $new->uri = ($parsed['scheme'] ?? 'http') . '://' . ($parsed['host'] ?? '') . $path .
                   (isset($parsed['query']) ? '?' . $parsed['query'] : '') .
                   (isset($parsed['fragment']) ? '#' . $parsed['fragment'] : '');
        return $new;
    }

    public function withQuery($query): UriInterface
    {
        $new = clone $this;
        $parsed = parse_url($this->uri);
        $new->uri = ($parsed['scheme'] ?? 'http') . '://' . ($parsed['host'] ?? '') . ($parsed['path'] ?? '') .
                   '?' . $query .
                   (isset($parsed['fragment']) ? '#' . $parsed['fragment'] : '');
        return $new;
    }

    public function withFragment($fragment): UriInterface
    {
        $new = clone $this;
        $parsed = parse_url($this->uri);
        $new->uri = ($parsed['scheme'] ?? 'http') . '://' . ($parsed['host'] ?? '') . ($parsed['path'] ?? '') .
                   (isset($parsed['query']) ? '?' . $parsed['query'] : '') .
                   '#' . $fragment;
        return $new;
    }

    public function __toString(): string
    {
        return $this->uri;
    }
}
