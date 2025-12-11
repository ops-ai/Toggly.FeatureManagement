<?php

namespace Toggly\WordPress\Http;

use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Toggly\WordPress\Http\WordPressResponse;

/**
 * WordPress HTTP client implementing PSR-18
 */
class WordPressHttpClient implements ClientInterface
{
    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        $url = (string)$request->getUri();
        $method = $request->getMethod();
        $headers = [];
        
        foreach ($request->getHeaders() as $name => $values) {
            $headers[$name] = implode(', ', $values);
        }

        $body = (string)$request->getBody();

        $args = [
            'method' => $method,
            'headers' => $headers,
            'body' => $body,
            'timeout' => 30,
        ];

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            throw new \RuntimeException('HTTP request failed: ' . $response->get_error_message());
        }

        return new WordPressResponse($response);
    }
}
