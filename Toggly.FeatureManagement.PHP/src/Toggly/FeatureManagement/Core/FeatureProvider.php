<?php

namespace Toggly\FeatureManagement\Core;

use Toggly\FeatureManagement\Config\TogglySettings;
use Toggly\FeatureManagement\Contracts\FeatureProviderInterface;
use Toggly\FeatureManagement\Contracts\FeatureSnapshotProviderInterface;
use Toggly\FeatureManagement\Contracts\FeatureStateServiceInterface;
use Toggly\FeatureManagement\Contracts\IFeatureExperimentProvider;
use Toggly\FeatureManagement\Contracts\SecureFeatureProviderInterface;
use Toggly\FeatureManagement\Exceptions\SignatureVerificationException;
use Toggly\FeatureManagement\Http\TogglyHttpClient;
use Toggly\FeatureManagement\Http\WebSocketClient;
use Toggly\FeatureManagement\Models\FeatureDefinition;
use Toggly\FeatureManagement\Models\SignedDefinitionsResponse;
use Toggly\FeatureManagement\Security\EcdsaSignatureVerifier;
use Toggly\FeatureManagement\Security\JwkManager;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Main feature provider that fetches and manages feature definitions from Toggly
 */
class FeatureProvider implements FeatureProviderInterface, SecureFeatureProviderInterface, IFeatureExperimentProvider
{
    private TogglySettings $settings;
    private TogglyHttpClient $httpClient;
    private ?FeatureSnapshotProviderInterface $snapshotProvider;
    private FeatureStateServiceInterface $featureStateService;
    private ?EcdsaSignatureVerifier $signatureVerifier;
    private ?JwkManager $jwkManager;
    private LoggerInterface $logger;
    private WebSocketClient $webSocketClient;

    /**
     * @var FeatureDefinition[] Cache of feature definitions by key
     */
    private array $definitions = [];

    /**
     * @var array<string, string[]> Map of metric keys to feature keys
     */
    private array $experiments = [];

    /**
     * @var string[] Set of secured feature keys
     */
    private array $secureFeatures = [];

    private bool $loaded = false;
    private ?int $lastDefinitionsTimestamp = null;
    private ?string $lastError = null;
    private ?int $lastErrorTime = null;
    private ?int $lastRefresh = null;
    private bool $refreshInProgress = false;

    public function __construct(
        TogglySettings $settings,
        TogglyHttpClient $httpClient,
        FeatureStateServiceInterface $featureStateService,
        ?FeatureSnapshotProviderInterface $snapshotProvider = null,
        ?LoggerInterface $logger = null
    ) {
        $this->settings = $settings;
        $this->httpClient = $httpClient;
        $this->snapshotProvider = $snapshotProvider;
        $this->featureStateService = $featureStateService;
        $this->logger = $logger ?? new NullLogger();
        $this->webSocketClient = new WebSocketClient($this->logger);

        // Initialize security components if signed definitions are enabled
        if ($settings->useSignedDefinitions) {
            $this->jwkManager = new JwkManager(
                $httpClient,
                $settings->getBaseUrl(),
                $snapshotProvider,
                $settings->allowedKeyIds,
                $this->logger
            );
            $this->signatureVerifier = new EcdsaSignatureVerifier($this->jwkManager, $this->logger);
        }

        // Load snapshot on startup
        $this->loadSnapshot();

        // Start refresh timer (using a simple approach - in production, use a proper scheduler)
        $this->startRefreshTimer();
    }

    /**
     * Start the refresh timer
     */
    private function startRefreshTimer(): void
    {
        // In a real implementation, you'd use a proper scheduler or background job
        // For now, we'll trigger refresh on first access and rely on external scheduling
        // In Laravel, this would be handled by a scheduled task
        // In WordPress, this would be handled by WP Cron
    }

    /**
     * Load snapshot from provider
     */
    private function loadSnapshot(): void
    {
        if ($this->snapshotProvider === null) {
            return;
        }

        try {
            $snapshot = $this->snapshotProvider->getFeaturesSnapshot();
            if ($snapshot['features'] === null || empty($snapshot['features'])) {
                return;
            }

            $features = $snapshot['features'];

            // Verify signature if using signed definitions
            if ($this->settings->useSignedDefinitions) {
                if ($snapshot['signature'] === null || $snapshot['keyId'] === null || $snapshot['timestamp'] === null) {
                    $this->logger->warning('Snapshot is missing required signature fields');
                    return;
                }

                try {
                    $jsonData = json_encode(array_map(fn($f) => $f->toArray(), $features), JSON_UNESCAPED_SLASHES);
                    $valid = $this->signatureVerifier->verifySnapshot(
                        $jsonData,
                        $snapshot['signature'],
                        $snapshot['keyId'],
                        $snapshot['timestamp']
                    );

                    if (!$valid) {
                        $this->logger->error('Invalid signature in snapshot');
                        return;
                    }
                } catch (SignatureVerificationException $e) {
                    $this->logger->error('Signature verification failed for snapshot', ['error' => $e->getMessage()]);
                    return;
                }
            }

            // Load definitions from snapshot
            foreach ($features as $featureDefinition) {
                $this->definitions[$featureDefinition->featureKey] = $featureDefinition;

                // Track secured features
                if ($featureDefinition->securedFeature) {
                    $this->secureFeatures[$featureDefinition->featureKey] = true;
                } else {
                    unset($this->secureFeatures[$featureDefinition->featureKey]);
                }

                // Update feature state
                $isEnabled = $this->isAlwaysOn($featureDefinition);
                if ($this->featureStateService instanceof FeatureStateService) {
                    $this->featureStateService->updateFeatureState($featureDefinition->featureKey, $isEnabled);
                }
            }

            // Update experiments mapping
            $this->updateExperimentsMapping($features);

            if ($this->featureStateService instanceof FeatureStateService) {
                $this->featureStateService->notifyDefinitionsChanged();
            }
            $this->loaded = true;
        } catch (\Exception $e) {
            $this->logger->error('Error loading from snapshot', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Refresh features from API
     */
    public function refreshFeatures(): void
    {
        if ($this->refreshInProgress) {
            $this->logger->debug('Refresh already in progress, skipping');
            return;
        }

        $this->refreshInProgress = true;

        try {
            // Ensure initial load happens
            if (!$this->loaded) {
                $this->loadSnapshot();
            }

            $path = $this->settings->useSignedDefinitions
                ? "definitions/v2/{$this->settings->appKey}/{$this->settings->environment}"
                : "definitions/{$this->settings->appKey}/{$this->settings->environment}";

            $response = $this->httpClient->get($path);

            // Handle 304 Not Modified
            if ($response === null) {
                $this->logger->debug('Features not modified (304)');
                return;
            }

            $response->getBody()->rewind();
            $body = $response->getBody()->getContents();
            $data = json_decode($body, true);

            if ($data === null) {
                $this->logger->warning('Received empty or invalid response from Toggly');
                return;
            }

            $features = [];

            if ($this->settings->useSignedDefinitions) {
                $signedResponse = new SignedDefinitionsResponse($data);

                // Check timestamp
                if ($this->lastDefinitionsTimestamp !== null && $signedResponse->timestamp < $this->lastDefinitionsTimestamp) {
                    $this->logger->warning('Received definitions with older timestamp', [
                        'current' => $this->lastDefinitionsTimestamp,
                        'received' => $signedResponse->timestamp,
                    ]);
                    return;
                }

                // Verify signature
                try {
                    // Get raw JSON for the defs array
                    $jsonDoc = json_decode($body, true);
                    $rawDefs = json_encode($jsonDoc['defs'] ?? [], JSON_UNESCAPED_SLASHES);
                    $dataToVerify = $rawDefs . '|' . $signedResponse->timestamp;

                    $valid = $this->signatureVerifier->verify(
                        $rawDefs,
                        $signedResponse->signature,
                        $signedResponse->kid,
                        $signedResponse->timestamp
                    );

                    if (!$valid) {
                        $this->logger->error('Invalid signature');
                        return;
                    }
                } catch (SignatureVerificationException $e) {
                    $this->logger->error('Signature verification failed', ['error' => $e->getMessage()]);
                    return;
                }

                $features = $signedResponse->defs;
                $this->lastDefinitionsTimestamp = $signedResponse->timestamp;

                // Save snapshot
                if ($this->snapshotProvider !== null) {
                    $this->snapshotProvider->saveSnapshot(
                        $features,
                        $signedResponse->signature,
                        $signedResponse->kid,
                        $signedResponse->timestamp
                    );
                }
            } else {
                // Unsigned definitions
                $features = array_map(function ($def) {
                    return new FeatureDefinition($def);
                }, $data);

                // Save snapshot
                if ($this->snapshotProvider !== null) {
                    $this->snapshotProvider->saveSnapshot($features);
                }
            }

            // Update definitions
            foreach ($features as $featureDefinition) {
                $this->definitions[$featureDefinition->featureKey] = $featureDefinition;

                // Track secured features
                if ($featureDefinition->securedFeature) {
                    $this->secureFeatures[$featureDefinition->featureKey] = true;
                } else {
                    unset($this->secureFeatures[$featureDefinition->featureKey]);
                }

                // Update feature state
                $isEnabled = $this->isAlwaysOn($featureDefinition);
                if ($this->featureStateService instanceof FeatureStateService) {
                    $this->featureStateService->updateFeatureState($featureDefinition->featureKey, $isEnabled);
                }
            }

            // Update experiments mapping
            $this->updateExperimentsMapping($features);

            if ($this->featureStateService instanceof FeatureStateService) {
                $this->featureStateService->notifyDefinitionsChanged();
            }
            $this->loaded = true;
            $this->lastRefresh = time();

            // Try to establish WebSocket connection
            $this->tryConnectWebSocket();
        } catch (\Exception $e) {
            $this->logger->error('Error refreshing features list', ['error' => $e->getMessage()]);
            $this->lastError = $e->getMessage();
            $this->lastErrorTime = time();
        } finally {
            $this->refreshInProgress = false;
        }
    }

    /**
     * Try to connect WebSocket for live updates
     */
    private function tryConnectWebSocket(): void
    {
        if (!$this->webSocketClient->isAvailable() || $this->webSocketClient->isRunning()) {
            return;
        }

        try {
            $path = "definitions/live-updates/{$this->settings->appKey}/{$this->settings->environment}";
            $response = $this->httpClient->get($path);

            if ($response === null) {
                return;
            }

            $response->getBody()->rewind();
            $wsUrl = trim($response->getBody()->getContents());

            if (empty($wsUrl)) {
                return;
            }

            $connected = $this->webSocketClient->connect($wsUrl, function () {
                $this->logger->info('WebSocket update received, refreshing features');
                $this->refreshFeatures();
            });

            if ($connected) {
                $this->logger->info('WebSocket connected for live updates');
            }
        } catch (\Exception $e) {
            $this->logger->warning('WebSocket not available, continuing without it', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Update experiments mapping from features
     * @param FeatureDefinition[] $features
     */
    private function updateExperimentsMapping(array $features): void
    {
        $this->experiments = [];

        foreach ($features as $feature) {
            if ($feature->metrics === null || empty($feature->metrics)) {
                continue;
            }

            foreach ($feature->metrics as $metricKey) {
                if (!isset($this->experiments[$metricKey])) {
                    $this->experiments[$metricKey] = [];
                }
                $this->experiments[$metricKey][] = $feature->featureKey;
            }
        }
    }

    /**
     * Check if feature has AlwaysOn filter
     */
    private function isAlwaysOn(FeatureDefinition $feature): bool
    {
        foreach ($feature->filters as $filter) {
            if ($filter->name === 'AlwaysOn') {
                return true;
            }
        }
        return false;
    }

    /**
     * @inheritDoc
     */
    public function getAllFeatureDefinitions(): array
    {
        // Wait for initial load with timeout
        if (!$this->loaded) {
            $maxWaitTime = 2.5; // seconds
            $elapsed = 0;
            $delay = 0.1; // 100ms

            while (!$this->loaded && $elapsed < $maxWaitTime) {
                usleep((int)($delay * 1000000)); // Convert to microseconds
                $elapsed += $delay;
            }
        }

        return array_values($this->definitions);
    }

    /**
     * @inheritDoc
     */
    public function getFeatureDefinition(string $featureName): ?FeatureDefinition
    {
        // Wait for initial load with timeout
        if (!$this->loaded) {
            $maxWaitTime = 2.5; // seconds
            $elapsed = 0;
            $delay = 0.1; // 100ms

            while (!$this->loaded && $elapsed < $maxWaitTime) {
                usleep((int)($delay * 1000000));
                $elapsed += $delay;
            }
        }

        if (isset($this->definitions[$featureName])) {
            return $this->definitions[$featureName];
        }

        // Return default definition if undefined
        if ($this->settings->undefinedEnabledOnDevelopment) {
            $def = new FeatureDefinition([
                'featureKey' => $featureName,
                'filters' => [['name' => 'AlwaysOn']],
            ]);
            return $def;
        }

        return null;
    }

    /**
     * @inheritDoc
     */
    public function getFeaturesForMetric(string $metricKey): ?array
    {
        return $this->experiments[$metricKey] ?? null;
    }

    /**
     * Check if a feature is secured
     */
    public function isFeatureSecured(string $featureKey): bool
    {
        return isset($this->secureFeatures[$featureKey]);
    }

    /**
     * Get the feature state service (for internal use)
     */
    public function getFeatureStateService(): FeatureStateServiceInterface
    {
        return $this->featureStateService;
    }

    /**
     * Get debug information
     */
    public function getDebugInfo(): array
    {
        return [
            'app_key' => $this->settings->appKey,
            'environment' => $this->settings->environment,
            'definitions_count' => count($this->definitions),
            'experiments_count' => count($this->experiments),
            'last_error' => $this->lastError,
            'last_error_time' => $this->lastErrorTime,
            'last_refresh' => $this->lastRefresh,
            'websocket_running' => $this->webSocketClient->isRunning(),
            'loaded' => $this->loaded,
        ];
    }
}
