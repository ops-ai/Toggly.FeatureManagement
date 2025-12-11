<?php

namespace Toggly\FeatureManagement\Models;

/**
 * Signed definitions response
 */
class SignedDefinitionsResponse
{
    /**
     * List of feature definitions
     * @var FeatureDefinition[]
     */
    public array $defs = [];

    /**
     * Signature of the definitions
     */
    public string $signature;

    /**
     * Timestamp of the definitions
     */
    public int $timestamp;

    /**
     * Key ID of the signature
     */
    public string $kid;

    public function __construct(array $data = [])
    {
        if (isset($data['defs'])) {
            $this->defs = array_map(function ($def) {
                return $def instanceof FeatureDefinition ? $def : new FeatureDefinition($def);
            }, $data['defs']);
        }
        if (isset($data['signature'])) {
            $this->signature = $data['signature'];
        }
        if (isset($data['timestamp'])) {
            $this->timestamp = (int)$data['timestamp'];
        }
        if (isset($data['kid'])) {
            $this->kid = $data['kid'];
        }
    }
}
