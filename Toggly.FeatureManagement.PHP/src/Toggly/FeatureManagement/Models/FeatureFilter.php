<?php

namespace Toggly\FeatureManagement\Models;

/**
 * Feature filter
 */
class FeatureFilter
{
    /**
     * Unique name of filter
     */
    public string $name;

    /**
     * List of parameters for filter
     * @var array<string, string>|null
     */
    public ?array $parameters = null;

    public function __construct(array $data = [])
    {
        if (isset($data['name'])) {
            $this->name = $data['name'];
        }
        if (isset($data['parameters'])) {
            $this->parameters = $data['parameters'];
        }
    }

    /**
     * Convert to array for JSON serialization
     */
    public function toArray(): array
    {
        $result = ['name' => $this->name];
        if ($this->parameters !== null) {
            $result['parameters'] = $this->parameters;
        }
        return $result;
    }

    /**
     * Check if this filter equals another
     */
    public function equals(?FeatureFilter $other): bool
    {
        if ($other === null) {
            return false;
        }
        
        if ($this->name !== $other->name) {
            return false;
        }

        if ($this->parameters === null && $other->parameters === null) {
            return true;
        }

        if ($this->parameters === null || $other->parameters === null) {
            return false;
        }

        return $this->parameters === $other->parameters;
    }
}
