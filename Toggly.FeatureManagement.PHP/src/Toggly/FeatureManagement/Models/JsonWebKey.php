<?php

namespace Toggly\FeatureManagement\Models;

/**
 * JSON Web Key
 */
class JsonWebKey
{
    /**
     * Key type
     */
    public string $kty;

    /**
     * Key use
     */
    public string $use = 'sig';

    /**
     * Key ID
     */
    public string $kid;

    /**
     * Curve
     */
    public string $crv;

    /**
     * X coordinate (base64url encoded)
     */
    public string $x;

    /**
     * Y coordinate (base64url encoded)
     */
    public string $y;

    /**
     * Algorithm
     */
    public string $alg;

    public function __construct(array $data = [])
    {
        if (isset($data['kty'])) {
            $this->kty = $data['kty'];
        }
        if (isset($data['use'])) {
            $this->use = $data['use'];
        }
        if (isset($data['kid'])) {
            $this->kid = $data['kid'];
        }
        if (isset($data['crv'])) {
            $this->crv = $data['crv'];
        }
        if (isset($data['x'])) {
            $this->x = $data['x'];
        }
        if (isset($data['y'])) {
            $this->y = $data['y'];
        }
        if (isset($data['alg'])) {
            $this->alg = $data['alg'];
        }
    }
}
