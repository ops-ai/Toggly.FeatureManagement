<?php

namespace Toggly\FeatureManagement\Security;

use Toggly\FeatureManagement\Exceptions\SignatureVerificationException;
use Toggly\FeatureManagement\Security\JwkManager;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Verifies ECDSA signatures for signed feature definitions
 */
class EcdsaSignatureVerifier
{
    private JwkManager $jwkManager;
    private LoggerInterface $logger;

    public function __construct(JwkManager $jwkManager, ?LoggerInterface $logger = null)
    {
        $this->jwkManager = $jwkManager;
        $this->logger = $logger ?? new NullLogger();
    }

    /**
     * Verify signature for signed definitions
     * @param string $data JSON data to verify
     * @param string $signature Base64-encoded signature
     * @param string $keyId Key ID
     * @param int $timestamp Timestamp
     * @return bool True if signature is valid
     * @throws SignatureVerificationException
     */
    public function verify(string $data, string $signature, string $keyId, int $timestamp): bool
    {
        try {
            // Get the ECDSA key
            $key = $this->jwkManager->getEcdsaKey($keyId);
            if ($key === null) {
                throw new SignatureVerificationException("No ES256 key found for key ID: {$keyId}");
            }

            // Create data string to verify: data|timestamp
            $dataToVerify = $data . '|' . $timestamp;

            // Compute SHA-256 hash
            $hash = hash('sha256', $dataToVerify, true);

            // Decode signature from base64
            $signatureBytes = base64_decode($signature, true);
            if ($signatureBytes === false) {
                throw new SignatureVerificationException('Invalid base64 signature');
            }

            // Convert P1363 (raw r||s) to ASN.1/DER format if needed
            if (strlen($signatureBytes) === 64) {
                $signatureBytes = $this->p1363ToDer($signatureBytes);
            }

            // Verify signature
            $result = openssl_verify($hash, $signatureBytes, $key, OPENSSL_ALGO_SHA256);

            if ($result === 1) {
                $this->logger->debug('Signature verification successful', ['keyId' => $keyId]);
                return true;
            } elseif ($result === 0) {
                throw new SignatureVerificationException('Invalid signature');
            } else {
                throw new SignatureVerificationException('Error verifying signature: ' . openssl_error_string());
            }
        } catch (SignatureVerificationException $e) {
            throw $e;
        } catch (\Exception $e) {
            $this->logger->error('Signature verification failed', [
                'error' => $e->getMessage(),
                'keyId' => $keyId,
            ]);
            throw new SignatureVerificationException('Signature verification failed: ' . $e->getMessage(), 0, $e);
        }
    }

    /**
     * Verify signature from snapshot
     * @param string $jsonData JSON data
     * @param string $signature Base64-encoded signature
     * @param string $keyId Key ID
     * @param int $timestamp Timestamp
     * @return bool True if signature is valid
     * @throws SignatureVerificationException
     */
    public function verifySnapshot(string $jsonData, string $signature, string $keyId, int $timestamp): bool
    {
        return $this->verify($jsonData, $signature, $keyId, $timestamp);
    }

    /**
     * Convert IEEE P1363 (raw r||s) signature to ASN.1/DER format.
     * Web Crypto API produces P1363 but OpenSSL expects DER.
     */
    private function p1363ToDer(string $p1363): string
    {
        $r = substr($p1363, 0, 32);
        $s = substr($p1363, 32, 32);

        // Trim leading zero bytes but ensure positive (add 0x00 if high bit set)
        $r = ltrim($r, "\x00");
        if (ord($r[0]) & 0x80) {
            $r = "\x00" . $r;
        }
        $s = ltrim($s, "\x00");
        if (ord($s[0]) & 0x80) {
            $s = "\x00" . $s;
        }

        // ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }
        $rDer = "\x02" . chr(strlen($r)) . $r;
        $sDer = "\x02" . chr(strlen($s)) . $s;
        $seq = $rDer . $sDer;

        return "\x30" . chr(strlen($seq)) . $seq;
    }
}
