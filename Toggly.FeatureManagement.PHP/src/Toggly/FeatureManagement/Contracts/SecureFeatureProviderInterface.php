<?php

namespace Toggly\FeatureManagement\Contracts;

/**
 * Service to identify features that require additional security checks
 */
interface SecureFeatureProviderInterface
{
    /**
     * Check if a feature requires a security check
     * @param string $featureKey Feature key
     * @return bool True if the feature requires a security check
     */
    public function isFeatureSecured(string $featureKey): bool;
}
