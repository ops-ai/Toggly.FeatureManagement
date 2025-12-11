<?php

namespace Toggly\FeatureManagement\Models;

/**
 * Feature definition model
 */
class FeatureDefinition
{
    /**
     * Unique key of feature
     */
    public string $featureKey;

    /**
     * List of filters to be checked to determine if feature is enabled
     * @var FeatureFilter[]
     */
    public array $filters = [];

    /**
     * List of metrics to be tracked
     * @var string[]|null
     */
    public ?array $metrics = null;

    /**
     * Feature is meant for security purposes as well
     */
    public bool $securedFeature = false;

    /**
     * Require all the filters to be true or at least one
     */
    public string $requirementType = 'Any'; // 'Any' or 'All'

    public function __construct(array $data = [])
    {
        if (isset($data['featureKey'])) {
            $this->featureKey = $data['featureKey'];
        }
        if (isset($data['filters'])) {
            $this->filters = array_map(function ($filter) {
                return $filter instanceof FeatureFilter ? $filter : new FeatureFilter($filter);
            }, $data['filters']);
        }
        if (isset($data['metrics'])) {
            $this->metrics = $data['metrics'];
        }
        if (isset($data['securedFeature'])) {
            $this->securedFeature = (bool)$data['securedFeature'];
        }
        if (isset($data['requirementType'])) {
            $this->requirementType = $data['requirementType'];
        }
    }

    /**
     * Convert to array for JSON serialization
     */
    public function toArray(): array
    {
        return [
            'featureKey' => $this->featureKey,
            'filters' => array_map(fn($f) => $f->toArray(), $this->filters),
            'metrics' => $this->metrics,
            'securedFeature' => $this->securedFeature,
            'requirementType' => $this->requirementType,
        ];
    }
}
