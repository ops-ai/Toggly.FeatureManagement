<?php

namespace Toggly\WordPress\Http;

use Psr\Http\Message\RequestFactoryInterface;
use Psr\Http\Message\RequestInterface;
use Toggly\WordPress\Http\WordPressRequest;

/**
 * WordPress request factory implementing PSR-17
 */
class WordPressRequestFactory implements RequestFactoryInterface
{
    public function createRequest(string $method, $uri): RequestInterface
    {
        return new WordPressRequest($method, $uri);
    }
}
