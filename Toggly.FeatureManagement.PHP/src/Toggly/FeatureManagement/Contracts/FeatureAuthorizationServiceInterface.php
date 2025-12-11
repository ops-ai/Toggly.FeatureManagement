<?php

namespace Toggly\FeatureManagement\Contracts;

/**
 * Service to provide additional authorization for secured features
 */
interface FeatureAuthorizationServiceInterface
{
    /**
     * Check if current context is authorized for feature
     * @param string $featureKey Feature key
     * @return bool True if authorized
     */
    public function isAllowed(string $featureKey): bool;
}
