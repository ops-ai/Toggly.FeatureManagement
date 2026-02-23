<?php

namespace Toggly\FeatureManagement\Http;

use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestFactoryInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * HTTP client wrapper for Toggly API with retry logic and ETag support
 */
class TogglyHttpClient
{
    private ClientInterface $httpClient;
    private RequestFactoryInterface $requestFactory;
    private LoggerInterface $logger;
    private string $baseUrl;
    private string $userAgent;
    private ?string $lastETag = null;

    public function __construct(
        ClientInterface $httpClient,
        RequestFactoryInterface $requestFactory,
        string $baseUrl,
        string $userAgent = 'Toggly.FeatureManagement.PHP/1.0',
        ?LoggerInterface $logger = null
    ) {
        $this->httpClient = $httpClient;
        $this->requestFactory = $requestFactory;
        $this->baseUrl = rtrim($baseUrl, '/') . '/';
        $this->userAgent = $userAgent;
        $this->logger = $logger ?? new NullLogger();
    }

    /**
     * Make a GET request with retry logic and ETag support
     * @param string $path API path (relative to base URL)
     * @param int $timeout Timeout in seconds
     * @return ResponseInterface|null Returns null if 304 Not Modified
     */
    public function get(string $path, int $timeout = 30): ?ResponseInterface
    {
        $url = $this->baseUrl . ltrim($path, '/');
        $maxRetries = 8;
        $attempt = 0;

        while ($attempt < $maxRetries) {
            try {
                $request = $this->requestFactory->createRequest('GET', $url);
                $request = $request->withHeader('User-Agent', $this->userAgent);
                $request = $request->withHeader('Accept', 'application/json');

                // Add ETag if we have one
                if ($this->lastETag !== null) {
                    $request = $request->withHeader('If-None-Match', $this->lastETag);
                }

                $response = $this->httpClient->sendRequest($request);

                // Handle 304 Not Modified
                if ($response->getStatusCode() === 304) {
                    return null;
                }

                // Handle success
                if ($response->getStatusCode() >= 200 && $response->getStatusCode() < 300) {
                    // Store ETag for next request
                    $etag = $response->getHeaderLine('ETag');
                    if ($etag !== '') {
                        $this->lastETag = $etag;
                    }
                    return $response;
                }

                // Handle 404 - retry with exponential backoff
                if ($response->getStatusCode() === 404) {
                    $attempt++;
                    if ($attempt < $maxRetries) {
                        $delay = pow(2, $attempt);
                        $this->logger->warning("Toggly API returned 404, retrying in {$delay} seconds", [
                            'url' => $url,
                            'attempt' => $attempt,
                        ]);
                        sleep($delay);
                        continue;
                    }
                }

                // Handle other errors
                $response->getBody()->rewind();
                $body = $response->getBody()->getContents();
                throw new \RuntimeException(
                    "Toggly API request failed: {$response->getStatusCode()} - {$body}",
                    $response->getStatusCode()
                );
            } catch (\Exception $e) {
                $attempt++;
                if ($attempt >= $maxRetries) {
                    $this->logger->error("Toggly API request failed after {$maxRetries} attempts", [
                        'url' => $url,
                        'error' => $e->getMessage(),
                    ]);
                    throw $e;
                }

                $delay = pow(2, $attempt);
                $this->logger->warning("Toggly API request failed, retrying in {$delay} seconds", [
                    'url' => $url,
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ]);
                sleep($delay);
            }
        }

        throw new \RuntimeException("Toggly API request failed after {$maxRetries} attempts");
    }

    /**
     * Make a POST request with retry logic
     * @param string $path API path
     * @param array|string $data Request body data
     * @return ResponseInterface
     */
    public function post(string $path, $data): ResponseInterface
    {
        $url = $this->baseUrl . ltrim($path, '/');
        $maxRetries = 8;
        $attempt = 0;

        $body = is_string($data) ? $data : json_encode($data);

        while ($attempt < $maxRetries) {
            try {
                $request = $this->requestFactory->createRequest('POST', $url);
                $request = $request->withHeader('User-Agent', $this->userAgent);
                $request = $request->withHeader('Content-Type', 'application/json');
                $request = $request->withHeader('Accept', 'application/json');
                $request->getBody()->write($body);

                $response = $this->httpClient->sendRequest($request);

                if ($response->getStatusCode() >= 200 && $response->getStatusCode() < 300) {
                    return $response;
                }

                $attempt++;
                if ($attempt < $maxRetries) {
                    $delay = pow(2, $attempt);
                    $this->logger->warning("Toggly API POST failed, retrying in {$delay} seconds", [
                        'url' => $url,
                        'attempt' => $attempt,
                        'status' => $response->getStatusCode(),
                    ]);
                    sleep($delay);
                    continue;
                }

                $response->getBody()->rewind();
                $body = $response->getBody()->getContents();
                throw new \RuntimeException(
                    "Toggly API POST failed: {$response->getStatusCode()} - {$body}",
                    $response->getStatusCode()
                );
            } catch (\Exception $e) {
                $attempt++;
                if ($attempt >= $maxRetries) {
                    $this->logger->error("Toggly API POST failed after {$maxRetries} attempts", [
                        'url' => $url,
                        'error' => $e->getMessage(),
                    ]);
                    throw $e;
                }

                $delay = pow(2, $attempt);
                $this->logger->warning("Toggly API POST failed, retrying in {$delay} seconds", [
                    'url' => $url,
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ]);
                sleep($delay);
            }
        }

        throw new \RuntimeException("Toggly API POST failed after {$maxRetries} attempts");
    }

    /**
     * Clear the stored ETag
     */
    public function clearETag(): void
    {
        $this->lastETag = null;
    }

    /**
     * Get the last ETag
     */
    public function getLastETag(): ?string
    {
        return $this->lastETag;
    }
}
