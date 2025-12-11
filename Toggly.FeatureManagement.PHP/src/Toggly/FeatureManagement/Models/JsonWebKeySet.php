<?php

namespace Toggly\FeatureManagement\Models;

/**
 * JSON Web Key Set
 */
class JsonWebKeySet
{
    /**
     * List of JSON Web Keys
     * @var JsonWebKey[]
     */
    public array $keys = [];

    public function __construct(array $data = [])
    {
        if (isset($data['keys'])) {
            $this->keys = array_map(function ($key) {
                return $key instanceof JsonWebKey ? $key : new JsonWebKey($key);
            }, $data['keys']);
        }
    }
}
