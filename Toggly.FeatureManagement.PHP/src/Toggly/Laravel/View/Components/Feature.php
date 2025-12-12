<?php

namespace Toggly\Laravel\View\Components;

use Illuminate\View\Component;
use Toggly\FeatureManagement\Core\FeatureManager;

/**
 * Blade component for conditionally rendering content based on feature flags.
 * 
 * Similar to C#'s <feature> tag helper in Razor views.
 * 
 * @example
 * <x-feature name="my-feature">
 *     <p>This is shown when the feature is enabled</p>
 * </x-feature>
 * 
 * <x-feature name="feature1,feature2" requirement="any">
 *     <p>Shown if any feature is enabled</p>
 * </x-feature>
 */
class Feature extends Component
{
    private FeatureManager $featureManager;
    public string|array $features;
    public string $requirement;
    public bool $isEnabled;

    /**
     * Create a new component instance.
     */
    public function __construct(
        FeatureManager $featureManager,
        string|array $name,
        string $requirement = 'any'
    ) {
        $this->featureManager = $featureManager;
        $this->features = is_string($name) ? explode(',', $name) : $name;
        $this->features = array_map('trim', (array) $this->features);
        $this->requirement = strtolower($requirement);
        
        $this->isEnabled = $this->checkFeatures();
    }

    /**
     * Check if features are enabled based on requirement
     */
    private function checkFeatures(): bool
    {
        $context = $this->getContext();
        $features = (array) $this->features;

        if ($this->requirement === 'all') {
            // All features must be enabled
            foreach ($features as $feature) {
                if (!$this->featureManager->isEnabled($feature, $context)) {
                    return false;
                }
            }
            return true;
        } else {
            // Any feature must be enabled (default)
            foreach ($features as $feature) {
                if ($this->featureManager->isEnabled($feature, $context)) {
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * Get context for feature evaluation
     */
    private function getContext(): array
    {
        $context = [];

        if (auth()->check()) {
            $user = auth()->user();
            $context['userId'] = $user->id;
            $context['user_id'] = $user->id;
            
            // Add groups if available
            if (method_exists($user, 'groups')) {
                $context['groups'] = $user->groups();
            }
        }

        if (request()) {
            $context['ip'] = request()->ip();
        }

        return $context;
    }

    /**
     * Get the view / contents that represent the component.
     */
    public function render()
    {
        return view('toggly::components.feature');
    }
}
