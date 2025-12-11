<?php

namespace Toggly\FeatureManagement\Core;

use Toggly\FeatureManagement\Contracts\FeatureAuthorizationServiceInterface;
use Toggly\FeatureManagement\Contracts\FeatureProviderInterface;
use Toggly\FeatureManagement\Contracts\SecureFeatureProviderInterface;
use Toggly\FeatureManagement\Contracts\UsageStatsProviderInterface;
use Toggly\FeatureManagement\Models\FeatureDefinition;
use Toggly\FeatureManagement\Models\FeatureFilter;

/**
 * Extended feature manager that records feature check stats and optionally checks for security
 */
class FeatureManager
{
    private FeatureProviderInterface $featureProvider;
    private UsageStatsProviderInterface $usageStatsProvider;
    private SecureFeatureProviderInterface $secureFeatureProvider;
    private ?FeatureAuthorizationServiceInterface $featureAuthorizationService;

    public function __construct(
        FeatureProviderInterface $featureProvider,
        UsageStatsProviderInterface $usageStatsProvider,
        SecureFeatureProviderInterface $secureFeatureProvider,
        ?FeatureAuthorizationServiceInterface $featureAuthorizationService = null
    ) {
        $this->featureProvider = $featureProvider;
        $this->usageStatsProvider = $usageStatsProvider;
        $this->secureFeatureProvider = $secureFeatureProvider;
        $this->featureAuthorizationService = $featureAuthorizationService;
    }

    /**
     * Check if a feature is enabled
     */
    public function isEnabled(string $feature, ?array $context = null): bool
    {
        $definition = $this->featureProvider->getFeatureDefinition($feature);
        if ($definition === null) {
            // Feature not defined
            $this->usageStatsProvider->recordCheck($feature, false);
            return false;
        }

        // Evaluate feature based on filters
        $allowed = $this->evaluateFeature($definition, $context);

        // Check authorization if feature is secured
        if ($allowed && $this->secureFeatureProvider->isFeatureSecured($feature)) {
            if ($this->featureAuthorizationService !== null) {
                $allowed = $this->featureAuthorizationService->isAllowed($feature);
            }
        }

        // Record usage stats
        if ($context !== null) {
            $this->usageStatsProvider->recordUsageWithContext($feature, $context, $allowed);
        } else {
            $this->usageStatsProvider->recordCheck($feature, $allowed);
        }

        return $allowed;
    }

    /**
     * Evaluate a feature definition based on its filters
     */
    private function evaluateFeature(FeatureDefinition $definition, ?array $context = null): bool
    {
        if (empty($definition->filters)) {
            return false;
        }

        $results = [];

        foreach ($definition->filters as $filter) {
            $results[] = $this->evaluateFilter($filter, $context);
        }

        // Apply requirement type
        if ($definition->requirementType === 'All') {
            return !in_array(false, $results, true);
        } else {
            // 'Any' - at least one must be true
            return in_array(true, $results, true);
        }
    }

    /**
     * Evaluate a single filter
     */
    private function evaluateFilter(FeatureFilter $filter, ?array $context = null): bool
    {
        switch ($filter->name) {
            case 'AlwaysOn':
                return true;

            case 'AlwaysOff':
                return false;

            case 'Percentage':
                return $this->evaluatePercentageFilter($filter, $context);

            case 'TimeWindow':
                return $this->evaluateTimeWindowFilter($filter);

            case 'Targeting':
                return $this->evaluateTargetingFilter($filter, $context);

            default:
                // Unknown filter - default to false
                return false;
        }
    }

    /**
     * Evaluate percentage filter
     */
    private function evaluatePercentageFilter(FeatureFilter $filter, ?array $context = null): bool
    {
        $percentage = (int)($filter->parameters['percentage'] ?? 0);
        if ($percentage <= 0) {
            return false;
        }
        if ($percentage >= 100) {
            return true;
        }

        // Use context identifier for consistent hashing
        $identifier = $this->getContextIdentifier($context);
        $hash = crc32($identifier . $filter->name);
        $bucket = abs($hash) % 100;

        return $bucket < $percentage;
    }

    /**
     * Evaluate time window filter
     */
    private function evaluateTimeWindowFilter(FeatureFilter $filter): bool
    {
        $now = time();
        $start = isset($filter->parameters['start']) ? strtotime($filter->parameters['start']) : null;
        $end = isset($filter->parameters['end']) ? strtotime($filter->parameters['end']) : null;

        if ($start !== null && $now < $start) {
            return false;
        }

        if ($end !== null && $now > $end) {
            return false;
        }

        return true;
    }

    /**
     * Evaluate targeting filter
     */
    private function evaluateTargetingFilter(FeatureFilter $filter, ?array $context = null): bool
    {
        if ($context === null) {
            return false;
        }

        // Check user ID
        if (isset($filter->parameters['users'])) {
            $users = explode(',', $filter->parameters['users']);
            $userId = $context['userId'] ?? $context['user_id'] ?? null;
            if ($userId !== null && in_array($userId, $users, true)) {
                return true;
            }
        }

        // Check groups
        if (isset($filter->parameters['groups'])) {
            $groups = explode(',', $filter->parameters['groups']);
            $userGroups = $context['groups'] ?? $context['group'] ?? [];
            if (is_string($userGroups)) {
                $userGroups = explode(',', $userGroups);
            }
            if (!empty(array_intersect($groups, $userGroups))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get context identifier for consistent hashing
     */
    private function getContextIdentifier(?array $context = null): string
    {
        if ($context !== null) {
            if (isset($context['userId'])) {
                return (string)$context['userId'];
            }
            if (isset($context['user_id'])) {
                return (string)$context['user_id'];
            }
            if (isset($context['ip'])) {
                return (string)$context['ip'];
            }
        }

        // Fallback to session ID or random
        return session_id() ?: uniqid('', true);
    }
}
