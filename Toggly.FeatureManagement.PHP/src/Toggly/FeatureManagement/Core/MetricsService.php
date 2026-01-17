<?php

namespace Toggly\FeatureManagement\Core;

use Toggly\FeatureManagement\Config\TogglySettings;
use Toggly\FeatureManagement\Contracts\FeatureProviderInterface;
use Toggly\FeatureManagement\Contracts\MetricsServiceInterface;
use Toggly\FeatureManagement\Http\TogglyHttpClient;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Service for collecting and sending custom metrics
 */
class MetricsService implements MetricsServiceInterface
{
    private TogglySettings $settings;
    private TogglyHttpClient $httpClient;
    private FeatureProviderInterface $featureProvider;
    private MetricsRegistryService $metricsRegistry;
    private LoggerInterface $logger;

    /**
     * @var array<string, array<string, float>> Measurements by metric key, variant-keyed
     */
    private array $measurements = [];

    /**
     * @var array<array{time: int, metricKey: string, featureKey: string|null, variant: string, value: float}> Observations
     */
    private array $observations = [];

    /**
     * @var array<string, array<string, float>> Counters by metric key, variant-keyed
     */
    private array $counters = [];

    private bool $sendInProgress = false;
    private ?int $lastSend = null;

    public function __construct(
        TogglySettings $settings,
        TogglyHttpClient $httpClient,
        FeatureProviderInterface $featureProvider,
        MetricsRegistryService $metricsRegistry,
        ?LoggerInterface $logger = null
    ) {
        $this->settings = $settings;
        $this->httpClient = $httpClient;
        $this->featureProvider = $featureProvider;
        $this->metricsRegistry = $metricsRegistry;
        $this->logger = $logger ?? new NullLogger();

        // Start send timer
        $this->startSendTimer();
    }

    /**
     * Start the send timer
     */
    private function startSendTimer(): void
    {
        // In a real implementation, you'd use a proper scheduler
    }

    /**
     * @inheritDoc
     */
    public function measure(string $metricKey, float $value): void
    {
        $this->incrementMeasurement($metricKey, null, $value, true);

        // Track for associated features
        $features = $this->featureProvider->getFeaturesForMetric($metricKey);
        if ($features !== null) {
            // In a real implementation, we'd check if features are enabled
            // For now, we'll just track the base measurement
            foreach ($features as $feature) {
                // This would require FeatureManager - simplified for now
                $this->incrementMeasurement($metricKey, $feature, $value, true);
            }
        }
    }

    /**
     * @inheritDoc
     */
    public function measureWithContext(string $metricKey, $context, float $value): void
    {
        $this->measure($metricKey, $value);
    }

    /**
     * @inheritDoc
     */
    public function observe(string $metricKey, float $value): void
    {
        $date = time();
        $this->storeObservation($date, $metricKey, null, $value, true);

        // Track for associated features
        $features = $this->featureProvider->getFeaturesForMetric($metricKey);
        if ($features !== null) {
            foreach ($features as $feature) {
                $this->storeObservation($date, $metricKey, $feature, $value, true);
            }
        }
    }

    /**
     * @inheritDoc
     */
    public function observeWithContext(string $metricKey, $context, float $value): void
    {
        $this->observe($metricKey, $value);
    }

    /**
     * @inheritDoc
     */
    public function incrementCounter(string $metricKey, float $value = 1.0): void
    {
        $this->incrementMetricCounter($metricKey, null, $value, true);

        // Track for associated features
        $features = $this->featureProvider->getFeaturesForMetric($metricKey);
        if ($features !== null) {
            foreach ($features as $feature) {
                $this->incrementMetricCounter($metricKey, $feature, $value, true);
            }
        }
    }

    /**
     * @inheritDoc
     */
    public function incrementCounterWithContext(string $metricKey, $context, float $value = 1.0): void
    {
        $this->incrementCounter($metricKey, $value);
    }

    /**
     * Increment a measurement (backward compatibility)
     */
    private function incrementMeasurement(string $metricKey, ?string $featureKey, float $value, bool $enabled): void
    {
        $variant = $enabled ? 'enabled' : 'disabled';
        $this->incrementMeasurementVariant($metricKey, $featureKey, $value, $variant);
    }

    /**
     * Increment a measurement with variant support
     */
    private function incrementMeasurementVariant(string $metricKey, ?string $featureKey, float $value, string $variant): void
    {
        $key = $featureKey !== null ? "{$metricKey}:{$featureKey}" : $metricKey;

        if (!isset($this->measurements[$key])) {
            $this->measurements[$key] = [];
        }

        if (!isset($this->measurements[$key][$variant])) {
            $this->measurements[$key][$variant] = 0.0;
        }

        $this->measurements[$key][$variant] += $value;
    }

    /**
     * Store an observation (backward compatibility)
     */
    private function storeObservation(int $date, string $metricKey, ?string $featureKey, float $value, bool $enabled): void
    {
        $variant = $enabled ? 'enabled' : 'disabled';
        $this->storeObservationVariant($date, $metricKey, $featureKey, $value, $variant);
    }

    /**
     * Store an observation with variant support
     */
    private function storeObservationVariant(int $date, string $metricKey, ?string $featureKey, float $value, string $variant): void
    {
        $this->observations[] = [
            'time' => $date,
            'metricKey' => $metricKey,
            'featureKey' => $featureKey,
            'variant' => $variant,
            'value' => $value,
        ];
    }

    /**
     * Increment a counter (backward compatibility)
     */
    private function incrementMetricCounter(string $metricKey, ?string $featureKey, float $value, bool $enabled): void
    {
        $variant = $enabled ? 'enabled' : 'disabled';
        $this->incrementMetricCounterVariant($metricKey, $featureKey, $value, $variant);
    }

    /**
     * Increment a counter with variant support
     */
    private function incrementMetricCounterVariant(string $metricKey, ?string $featureKey, float $value, string $variant): void
    {
        $key = $featureKey !== null ? "{$metricKey}:{$featureKey}" : $metricKey;

        if (!isset($this->counters[$key])) {
            $this->counters[$key] = [];
        }

        if (!isset($this->counters[$key][$variant])) {
            $this->counters[$key][$variant] = 0.0;
        }

        $this->counters[$key][$variant] += $value;
    }

    /**
     * Send metrics to Toggly
     */
    public function sendMetrics(): void
    {
        if ($this->sendInProgress) {
            $this->logger->debug('Send metrics already in progress, skipping');
            return;
        }

        // Get values from registry
        $registryMeasurements = $this->metricsRegistry->getMeasurementValues();
        foreach ($registryMeasurements as $key => $value) {
            $this->incrementMeasurement($key, null, $value, true);
        }

        $registryCounters = $this->metricsRegistry->getCounterValues();
        foreach ($registryCounters as $key => $value) {
            $this->incrementMetricCounter($key, null, $value, true);
        }

        $registryObservations = $this->metricsRegistry->getObservationValues();
        foreach ($registryObservations as $key => $data) {
            $this->storeObservation($data[0], $key, null, $data[1], true);
        }

        if (empty($this->measurements) && empty($this->counters) && empty($this->observations)) {
            $this->logger->debug('No metrics to send');
            return;
        }

        $this->sendInProgress = true;

        try {
            // Clone metrics to send
            $measurementsToSend = $this->measurements;
            $countersToSend = $this->counters;
            $observationsToSend = $this->observations;

            // Clear current metrics
            $this->measurements = [];
            $this->counters = [];
            $this->observations = [];

            // Build payload
            $payload = [
                'appKey' => $this->settings->appKey,
                'environment' => $this->settings->environment,
                'time' => date('c'),
                'instanceName' => $this->settings->instanceName ?? gethostname(),
                'stats' => [],
                'counters' => [],
                'observations' => [],
            ];

            // Process measurements
            foreach ($measurementsToSend as $key => $variantValues) {
                [$metricKey, $featureKey] = $this->parseKey($key);
                $stat = [
                    'metric' => $metricKey,
                    'variantValues' => $variantValues, // Now sends all variants as a map
                ];
                if ($featureKey !== null) {
                    $stat['feature'] = $featureKey;
                }
                $payload['stats'][] = $stat;
            }

            // Process counters
            foreach ($countersToSend as $key => $variantValues) {
                [$metricKey, $featureKey] = $this->parseKey($key);
                $counter = [
                    'metric' => $metricKey,
                    'variantValues' => $variantValues, // Now sends all variants as a map
                ];
                if ($featureKey !== null) {
                    $counter['feature'] = $featureKey;
                }
                $payload['counters'][] = $counter;
            }

            // Process observations (group by time+metric+feature)
            $observationGroups = [];
            foreach ($observationsToSend as $obs) {
                $groupKey = $obs['time'] . ':' . $obs['metricKey'] . ':' . ($obs['featureKey'] ?? '');
                
                if (!isset($observationGroups[$groupKey])) {
                    $observationGroups[$groupKey] = [
                        'metric' => $obs['metricKey'],
                        'time' => date('c', $obs['time']),
                        'variantValues' => [],
                    ];
                    if ($obs['featureKey'] !== null) {
                        $observationGroups[$groupKey]['feature'] = $obs['featureKey'];
                    }
                }
                
                $observationGroups[$groupKey]['variantValues'][$obs['variant']] = $obs['value'];
            }
            
            $payload['observations'] = array_values($observationGroups);

            // Send to API
            $this->httpClient->post('api/metrics', $payload);

            $this->lastSend = time();
            $this->logger->debug('Metrics sent successfully');
        } catch (\Exception $e) {
            // Restore metrics on error
            $this->measurements = array_merge_recursive($this->measurements, $measurementsToSend ?? []);
            $this->counters = array_merge_recursive($this->counters, $countersToSend ?? []);
            $this->observations = array_merge($this->observations, $observationsToSend ?? []);

            $this->logger->error('Error sending metrics to Toggly', ['error' => $e->getMessage()]);
        } finally {
            $this->sendInProgress = false;
        }
    }

    /**
     * Parse a key into metric key and feature key
     * @return array{0: string, 1: string|null}
     */
    private function parseKey(string $key): array
    {
        $parts = explode(':', $key, 2);
        if (count($parts) === 2) {
            return [$parts[0], $parts[1]];
        }
        return [$key, null];
    }
}
