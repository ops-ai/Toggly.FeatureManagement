<?php

namespace Toggly\Laravel\Http;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Toggly\FeatureManagement\Contracts\FeatureContextProviderInterface;

/**
 * HTTP context provider for Laravel
 */
class HttpFeatureContextProvider implements FeatureContextProviderInterface
{
    private Request $request;
    private array $accessedFeatures = [];

    public function __construct(Request $request)
    {
        $this->request = $request;
    }

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
        $user = Auth::user();
        
        if ($user !== null) {
            // Try to get identifier from user
            if (isset($user->email)) {
                return $user->email;
            }
            if (isset($user->id)) {
                return (string)$user->id;
            }
            if (method_exists($user, 'getAuthIdentifier')) {
                return (string)$user->getAuthIdentifier();
            }
        }

        // Fallback to IP address
        return $this->request->ip();
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
