<?php

namespace Toggly\WordPress\Http;

use Toggly\FeatureManagement\Contracts\FeatureContextProviderInterface;

/**
 * WordPress feature context provider
 */
class WordPressFeatureContextProvider implements FeatureContextProviderInterface
{
    private array $accessedFeatures = [];

    /**
     * @inheritDoc
     */
    public function accessedInRequest(string $featureName): bool
    {
        $key = "feature-{$featureName}";
        
        if (isset($this->accessedFeatures[$key])) {
            return true;
        }

        $this->accessedFeatures[$key] = true;
        return false;
    }

    /**
     * @inheritDoc
     */
    public function accessedInRequestWithContext(string $featureName, $context): bool
    {
        return $this->accessedInRequest($featureName);
    }

    /**
     * @inheritDoc
     */
    public function getContextIdentifier(): ?string
    {
        $user = wp_get_current_user();
        
        if ($user && $user->ID > 0) {
            // Try email first
            if (!empty($user->user_email)) {
                return $user->user_email;
            }
            // Fallback to user ID
            return (string)$user->ID;
        }

        // Fallback to IP address
        return $_SERVER['REMOTE_ADDR'] ?? null;
    }

    /**
     * @inheritDoc
     */
    public function getContextIdentifierWithContext($context): ?string
    {
        if (is_array($context)) {
            if (isset($context['userId'])) {
                return (string)$context['userId'];
            }
            if (isset($context['user_id'])) {
                return (string)$context['user_id'];
            }
            if (isset($context['email'])) {
                return (string)$context['email'];
            }
        }

        return $this->getContextIdentifier();
    }
}
