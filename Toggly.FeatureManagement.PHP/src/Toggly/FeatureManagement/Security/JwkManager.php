<?php

namespace Toggly\FeatureManagement\Security;

use Toggly\FeatureManagement\Contracts\FeatureSnapshotProviderInterface;
use Toggly\FeatureManagement\Http\TogglyHttpClient;
use Toggly\FeatureManagement\Models\JsonWebKey;
use Toggly\FeatureManagement\Models\JsonWebKeySet;
use Psr\Http\Message\ResponseInterface;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Manages JSON Web Keys for signature verification
 */
class JwkManager
{
    private TogglyHttpClient $httpClient;
    private ?FeatureSnapshotProviderInterface $snapshotProvider;
    private LoggerInterface $logger;
    private string $baseUrl;

    /**
     * Cache of ECDSA keys by key ID
     * @var array<string, array{key: resource, expiry: int}>
     */
    private array $keyCache = [];

    /**
     * @var string[]|null Allowed key IDs (whitelist)
     */
    private ?array $allowedKeyIds = null;

    public function __construct(
        TogglyHttpClient $httpClient,
        string $baseUrl,
        ?FeatureSnapshotProviderInterface $snapshotProvider = null,
        ?array $allowedKeyIds = null,
        ?LoggerInterface $logger = null
    ) {
        $this->httpClient = $httpClient;
        $this->baseUrl = rtrim($baseUrl, '/') . '/';
        $this->snapshotProvider = $snapshotProvider;
        $this->allowedKeyIds = $allowedKeyIds;
        $this->logger = $logger ?? new NullLogger();
    }

    /**
     * Get ECDSA key for a given key ID
     * @return resource|null OpenSSL key resource or null if not found
     */
    public function getEcdsaKey(string $keyId)
    {
        // Check whitelist
        if ($this->allowedKeyIds !== null && !in_array($keyId, $this->allowedKeyIds, true)) {
            $this->logger->error("Key ID not in allowed list", ['keyId' => $keyId]);
            return null;
        }

        // Check cache
        if (isset($this->keyCache[$keyId])) {
            $cached = $this->keyCache[$keyId];
            if ($cached['expiry'] > time()) {
                return $cached['key'];
            }
            // Remove expired key
            unset($this->keyCache[$keyId]);
        }

        // Try to load from snapshot first
        if ($this->snapshotProvider !== null) {
            $snapshot = $this->snapshotProvider->getJwkSnapshot();
            if ($snapshot['jwks'] !== null) {
                $key = $this->findKeyInJwks($snapshot['jwks'], $keyId);
                if ($key !== null) {
                    return $key;
                }
            }
        }

        // Fetch from API
        try {
            $response = $this->httpClient->get('.well-known/jwks');
            if ($response === null) {
                return null;
            }

            $response->getBody()->rewind();
            $data = json_decode($response->getBody()->getContents(), true);
            if ($data === null) {
                $this->logger->error('Failed to parse JWKS response');
                return null;
            }

            $jwks = new JsonWebKeySet($data);
            $key = $this->findKeyInJwks($jwks, $keyId);

            // Save to snapshot if provider available
            if ($key !== null && $this->snapshotProvider !== null) {
                $this->snapshotProvider->saveJwkSnapshot($jwks, time() + (30 * 24 * 60 * 60)); // 30 days
            }

            return $key;
        } catch (\Exception $e) {
            $this->logger->error('Failed to fetch JWKS', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Find and construct ECDSA key from JWKS
     * @return resource|null
     */
    private function findKeyInJwks(JsonWebKeySet $jwks, string $keyId)
    {
        foreach ($jwks->keys as $jwk) {
            // Verify key ID matches
            $computedKid = $this->computeKeyId($jwk);
            if ($computedKid !== $jwk->kid) {
                $this->logger->error('Invalid key ID in JWKS', [
                    'expected' => $computedKid,
                    'actual' => $jwk->kid,
                ]);
                continue;
            }

            // Check if this is the key we're looking for
            if ($jwk->kid === $keyId && $jwk->alg === 'ES256') {
                return $this->constructEcdsaKey($jwk);
            }
        }

        $this->logger->error('No valid matching ES256 key found in JWKS', ['keyId' => $keyId]);
        return null;
    }

    /**
     * Compute key ID from JWK coordinates
     */
    private function computeKeyId(JsonWebKey $jwk): string
    {
        // Convert base64url to binary
        $x = $this->base64urlDecode($jwk->x);
        $y = $this->base64urlDecode($jwk->y);

        // Concatenate X and Y coordinates
        $kidInput = $x . $y;

        // Compute SHA-1 hash
        $hash = sha1($kidInput, true);

        // Convert to hex and append algorithm
        return strtoupper(bin2hex($hash)) . 'ES256';
    }

    /**
     * Construct ECDSA key resource from JWK
     * @return resource|null
     */
    private function constructEcdsaKey(JsonWebKey $jwk)
    {
        try {
            // Convert base64url to binary
            $x = $this->base64urlDecode($jwk->x);
            $y = $this->base64urlDecode($jwk->y);

            // Create EC public key from coordinates
            // Use OpenSSL to create the key structure
            $pem = $this->createEcPublicKeyPem($x, $y);

            $publicKey = openssl_pkey_get_public($pem);
            if ($publicKey === false) {
                $this->logger->error('Failed to construct public key from coordinates', [
                    'error' => openssl_error_string()
                ]);
                return null;
            }

            // Cache the key for 30 days
            $this->keyCache[$jwk->kid] = [
                'key' => $publicKey,
                'expiry' => time() + (30 * 24 * 60 * 60),
            ];

            return $publicKey;
        } catch (\Exception $e) {
            $this->logger->error('Failed to construct ECDSA key', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Convert base64url to binary
     */
    private function base64urlDecode(string $data): string
    {
        // Convert base64url to base64
        $data = str_replace(['-', '_'], ['+', '/'], $data);
        // Add padding
        $padding = strlen($data) % 4;
        if ($padding > 0) {
            $data .= str_repeat('=', 4 - $padding);
        }
        return base64_decode($data, true);
    }

    /**
     * Create EC public key PEM from X and Y coordinates
     * Creates a proper ASN.1 encoded EC public key for P-256 curve
     */
    private function createEcPublicKeyPem(string $x, string $y): string
    {
        // Ensure coordinates are exactly 32 bytes (P-256)
        $x = str_pad($x, 32, "\x00", STR_PAD_LEFT);
        $y = str_pad($y, 32, "\x00", STR_PAD_LEFT);

        // Uncompressed point format: 0x04 || X || Y
        $point = "\x04" . $x . $y;

        // ASN.1 structure for EC public key:
        // SEQUENCE {
        //   SEQUENCE {
        //     OBJECT IDENTIFIER ecPublicKey (1.2.840.10045.2.1)
        //     OBJECT IDENTIFIER prime256v1 (1.2.840.10045.3.1.7)
        //   }
        //   BIT STRING { point }
        // }

        // OID for ecPublicKey: 1.2.840.10045.2.1
        $ecPublicKeyOid = "\x2a\x86\x48\xce\x3d\x02\x01";
        
        // OID for prime256v1: 1.2.840.10045.3.1.7
        $prime256v1Oid = "\x2a\x86\x48\xce\x3d\x03\x01\x07";

        // Algorithm identifier sequence
        $algorithmId = $this->encodeAsn1Sequence(
            $this->encodeAsn1ObjectIdentifier($ecPublicKeyOid) .
            $this->encodeAsn1ObjectIdentifier($prime256v1Oid)
        );

        // Bit string containing the point
        $bitString = $this->encodeAsn1BitString($point);

        // Public key info sequence
        $publicKeyInfo = $this->encodeAsn1Sequence($algorithmId . $bitString);

        // Base64 encode and wrap in PEM
        return "-----BEGIN PUBLIC KEY-----\n" .
               chunk_split(base64_encode($publicKeyInfo), 64, "\n") .
               "-----END PUBLIC KEY-----";
    }

    /**
     * Encode ASN.1 SEQUENCE
     */
    private function encodeAsn1Sequence(string $content): string
    {
        $length = strlen($content);
        return "\x30" . $this->encodeAsn1Length($length) . $content;
    }

    /**
     * Encode ASN.1 OBJECT IDENTIFIER
     */
    private function encodeAsn1ObjectIdentifier(string $oid): string
    {
        $length = strlen($oid);
        return "\x06" . $this->encodeAsn1Length($length) . $oid;
    }

    /**
     * Encode ASN.1 BIT STRING
     */
    private function encodeAsn1BitString(string $content): string
    {
        $length = strlen($content) + 1; // +1 for unused bits byte
        return "\x03" . $this->encodeAsn1Length($length) . "\x00" . $content;
    }

    /**
     * Encode ASN.1 length
     */
    private function encodeAsn1Length(int $length): string
    {
        if ($length < 128) {
            return chr($length);
        }

        $bytes = [];
        while ($length > 0) {
            array_unshift($bytes, $length & 0xFF);
            $length >>= 8;
        }

        return chr(0x80 | count($bytes)) . pack('C*', ...$bytes);
    }
}
