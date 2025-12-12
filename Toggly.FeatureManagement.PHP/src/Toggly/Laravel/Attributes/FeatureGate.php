<?php

namespace Toggly\Laravel\Attributes;

use Attribute;

/**
 * FeatureGate attribute to gate controllers and methods based on feature flags.
 * 
 * Similar to C#'s [FeatureGate] attribute, this can be applied to:
 * - Controller classes (gates all actions)
 * - Controller methods (gates individual actions)
 * 
 * @example
 * #[FeatureGate('my-feature')]
 * class MyController extends Controller { }
 * 
 * #[FeatureGate('another-feature')]
 * public function index() { }
 */
#[Attribute(Attribute::TARGET_CLASS | Attribute::TARGET_METHOD | Attribute::IS_REPEATABLE)]
class FeatureGate
{
    /**
     * @param string|array<string> $features Feature name(s) to check
     * @param string $requirement Whether ALL or ANY features must be enabled (default: 'Any')
     * @param int|null $statusCode HTTP status code to return if feature is disabled (default: 404)
     * @param string|null $redirectTo URL to redirect to if feature is disabled (alternative to statusCode)
     */
    public function __construct(
        public string|array $features,
        public string $requirement = 'Any',
        public ?int $statusCode = 404,
        public ?string $redirectTo = null
    ) {
        // Normalize features to array
        if (is_string($this->features)) {
            $this->features = [$this->features];
        }
        
        // Validate requirement
        if (!in_array($this->requirement, ['All', 'Any'], true)) {
            throw new \InvalidArgumentException("Requirement must be 'All' or 'Any'");
        }
    }

    /**
     * Get feature names as array
     */
    public function getFeatures(): array
    {
        return is_array($this->features) ? $this->features : [$this->features];
    }
}
