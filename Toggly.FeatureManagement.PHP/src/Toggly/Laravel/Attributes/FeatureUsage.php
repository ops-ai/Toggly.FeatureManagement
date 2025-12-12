<?php

namespace Toggly\Laravel\Attributes;

use Attribute;

/**
 * FeatureUsage attribute to mark controllers and methods as actively using features.
 * 
 * This is different from FeatureGate - it marks usage for statistics/reporting,
 * but doesn't gate access. Should be used AFTER FeatureGate if both are present.
 * 
 * Similar to C#'s [FeatureUsage] attribute.
 * 
 * @example
 * #[FeatureGate('my-feature')]
 * #[FeatureUsage('my-feature')]
 * class MyController extends Controller { }
 */
#[Attribute(Attribute::TARGET_CLASS | Attribute::TARGET_METHOD | Attribute::IS_REPEATABLE)]
class FeatureUsage
{
    /**
     * @param string|array<string> $features Feature name(s) that are being used
     */
    public function __construct(
        public string|array $features
    ) {
        // Normalize features to array
        if (is_string($this->features)) {
            $this->features = [$this->features];
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
