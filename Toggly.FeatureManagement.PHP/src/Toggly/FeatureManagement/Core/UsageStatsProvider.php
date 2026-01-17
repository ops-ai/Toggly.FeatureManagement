<?php

namespace Toggly\FeatureManagement\Core;

use Toggly\FeatureManagement\Config\TogglySettings;
use Toggly\FeatureManagement\Contracts\FeatureContextProviderInterface;
use Toggly\FeatureManagement\Contracts\UsageStatsProviderInterface;
use Toggly\FeatureManagement\Http\TogglyHttpClient;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Collects and sends feature usage statistics to Toggly
 */
class UsageStatsProvider implements UsageStatsProviderInterface
{
    private TogglySettings $settings;
    private TogglyHttpClient $httpClient;
    private ?FeatureContextProviderInterface $contextProvider;
    private LoggerInterface $logger;

    /**
     * @var array<string, array<string, int>> Statistics: [featureKey][statType] => count
     */
    private array $stats = [];

    /**
     * @var array<string, array<int>> Unique user IDs per feature (enabled)
     */
    private array $uniqueUsageEnabled = [];

    /**
     * @var array<string, array<int>> Unique user IDs per feature (disabled)
     */
    private array $uniqueUsageDisabled = [];

    /**
     * @var array<string, array<int>> Unique user IDs per feature (used)
     */
    private array $uniqueUsageUsed = [];

    /**
     * @var array<string, array<int>> Unique user hashes for monthly tracking (USED)
     */
    private array $uniqueUserHashes = [];

    /**
     * @var array<string, array<int>> Unique viewed user hashes for monthly tracking (VIEWED)
     */
    private array $uniqueViewedUserHashes = [];

    /**
     * @var array<int> Application-level unique user hashes
     */
    private array $applicationUniqueUserHashes = [];

    private const MAX_UNIQUE_USER_HASHES_PER_FEATURE = 10000;
    private const MAX_APPLICATION_UNIQUE_USER_HASHES = 10000;

    private const STAT_TYPE_ENABLED = 0;
    private const STAT_TYPE_DISABLED = 1;
    private const STAT_TYPE_UNIQUE_REQUEST_ENABLED = 2;
    private const STAT_TYPE_UNIQUE_REQUEST_DISABLED = 3;
    private const STAT_TYPE_USED = 4;

    private bool $sendInProgress = false;
    private ?int $lastSend = null;

    public function __construct(
        TogglySettings $settings,
        TogglyHttpClient $httpClient,
        ?FeatureContextProviderInterface $contextProvider = null,
        ?LoggerInterface $logger = null
    ) {
        $this->settings = $settings;
        $this->httpClient = $httpClient;
        $this->contextProvider = $contextProvider;
        $this->logger = $logger ?? new NullLogger();

        // Start send timer (in production, use proper scheduler)
        $this->startSendTimer();
    }

    /**
     * Start the send timer
     */
    private function startSendTimer(): void
    {
        // In a real implementation, you'd use a proper scheduler
        // In Laravel, this would be handled by a scheduled task
        // In WordPress, this would be handled by WP Cron
    }

    /**
     * @inheritDoc
     */
    public function recordCheck(string $featureKey, bool $allowed): void
    {
        $statType = $allowed ? self::STAT_TYPE_ENABLED : self::STAT_TYPE_DISABLED;
        $this->incrementStat($featureKey, $statType);

        if ($this->contextProvider !== null) {
            $accessed = $this->contextProvider->accessedInRequest($featureKey);
            if (!$accessed) {
                $uniqueRequestType = $allowed ? self::STAT_TYPE_UNIQUE_REQUEST_ENABLED : self::STAT_TYPE_UNIQUE_REQUEST_DISABLED;
                $this->incrementStat($featureKey, $uniqueRequestType);
            }

            $identifier = $this->contextProvider->getContextIdentifier();
            if ($identifier !== null) {
                $hash = $this->getDeterministicHashCode($identifier);
                $map = $allowed ? $this->uniqueUsageEnabled : $this->uniqueUsageDisabled;
                if (!isset($map[$featureKey])) {
                    $map[$featureKey] = [];
                }
                if (!in_array($hash, $map[$featureKey], true)) {
                    $map[$featureKey][] = $hash;
                }
                if ($allowed) {
                    $this->uniqueUsageEnabled = $map;
                } else {
                    $this->uniqueUsageDisabled = $map;
                }

                // Track application-level unique user
                $this->recordApplicationUniqueUserId($identifier);
            }
        }
    }

    /**
     * @inheritDoc
     */
    public function recordUsageWithContext(string $featureKey, $context, bool $allowed): void
    {
        $this->recordCheck($featureKey, $allowed);
    }

    /**
     * @inheritDoc
     */
    public function recordUsage(string $featureKey): void
    {
        $this->incrementStat($featureKey, self::STAT_TYPE_USED);

        if ($this->contextProvider !== null) {
            $identifier = $this->contextProvider->getContextIdentifier();
            if ($identifier !== null) {
                $hash = $this->getDeterministicHashCode($identifier);
                if (!isset($this->uniqueUsageUsed[$featureKey])) {
                    $this->uniqueUsageUsed[$featureKey] = [];
                }
                if (!in_array($hash, $this->uniqueUsageUsed[$featureKey], true)) {
                    $this->uniqueUsageUsed[$featureKey][] = $hash;
                }

                // Track feature-level unique user
                $this->recordUniqueUserId($featureKey, $identifier);

                // Track application-level unique user
                $this->recordApplicationUniqueUserId($identifier);
            }
        }
    }

    /**
     * Increment a statistic
     */
    private function incrementStat(string $featureKey, int $statType): void
    {
        if (!isset($this->stats[$featureKey])) {
            $this->stats[$featureKey] = [];
        }
        if (!isset($this->stats[$featureKey][$statType])) {
            $this->stats[$featureKey][$statType] = 0;
        }
        $this->stats[$featureKey][$statType]++;
    }

    /**
     * Record unique user ID for a feature (USED tracking)
     */
    private function recordUniqueUserId(string $featureKey, string $userId): void
    {
        if (empty($featureKey) || empty($userId)) {
            return;
        }

        $hash = $this->getDeterministicHashCode($userId);
        if (!isset($this->uniqueUserHashes[$featureKey])) {
            $this->uniqueUserHashes[$featureKey] = [];
        }

        if (count($this->uniqueUserHashes[$featureKey]) >= self::MAX_UNIQUE_USER_HASHES_PER_FEATURE) {
            $this->logger->warning("Unique user hash limit reached for feature", ['feature' => $featureKey]);
        }

        if (!in_array($hash, $this->uniqueUserHashes[$featureKey], true)) {
            $this->uniqueUserHashes[$featureKey][] = $hash;
        }
    }

    /**
     * Record unique viewed user ID for a feature (VIEWED tracking)
     */
    private function recordUniqueViewedUserId(string $featureKey, string $userId): void
    {
        if (empty($featureKey) || empty($userId)) {
            return;
        }

        $hash = $this->getDeterministicHashCode($userId);
        if (!isset($this->uniqueViewedUserHashes[$featureKey])) {
            $this->uniqueViewedUserHashes[$featureKey] = [];
        }

        if (count($this->uniqueViewedUserHashes[$featureKey]) >= self::MAX_UNIQUE_USER_HASHES_PER_FEATURE) {
            $this->logger->warning("Unique viewed user hash limit reached for feature", ['feature' => $featureKey]);
            return;
        }

        if (!in_array($hash, $this->uniqueViewedUserHashes[$featureKey], true)) {
            $this->uniqueViewedUserHashes[$featureKey][] = $hash;
        }
    }

    /**
     * Record application-level unique user ID
     */
    private function recordApplicationUniqueUserId(string $userId): void
    {
        if (empty($userId)) {
            return;
        }

        $hash = $this->getDeterministicHashCode($userId);

        if (count($this->applicationUniqueUserHashes) >= self::MAX_APPLICATION_UNIQUE_USER_HASHES) {
            $this->logger->warning("Application-level unique user hash limit reached");
        }

        if (!in_array($hash, $this->applicationUniqueUserHashes, true)) {
            $this->applicationUniqueUserHashes[] = $hash;
        }
    }

    /**
     * Get deterministic hash code for a string
     */
    private function getDeterministicHashCode(string $str): int
    {
        // Use DJB2-like hash algorithm for consistency
        $hash = 5381;
        $len = strlen($str);
        for ($i = 0; $i < $len; $i++) {
            $hash = (($hash << 5) + $hash) + ord($str[$i]);
        }
        return $hash;
    }

    /**
     * Send statistics to Toggly
     */
    public function sendStats(): void
    {
        if ($this->sendInProgress) {
            $this->logger->debug('Send stats already in progress, skipping');
            return;
        }

        if (empty($this->stats) && empty($this->uniqueUserHashes) && empty($this->uniqueViewedUserHashes) && empty($this->applicationUniqueUserHashes)) {
            $this->logger->debug('No stats to send');
            return;
        }

        $this->sendInProgress = true;

        try {
            // Clone stats to send
            $statsToSend = $this->stats;
            $uniqueEnabledToSend = $this->uniqueUsageEnabled;
            $uniqueDisabledToSend = $this->uniqueUsageDisabled;
            $uniqueUsedToSend = $this->uniqueUsageUsed;
            $uniqueHashesToSend = $this->uniqueUserHashes;
            $uniqueViewedHashesToSend = $this->uniqueViewedUserHashes;
            $appHashesToSend = $this->applicationUniqueUserHashes;

            // Clear current stats
            $this->stats = [];
            $this->uniqueUsageEnabled = [];
            $this->uniqueUsageDisabled = [];
            $this->uniqueUsageUsed = [];
            $this->uniqueUserHashes = [];
            $this->uniqueViewedUserHashes = [];
            $this->applicationUniqueUserHashes = [];

            // Build payload
            $payload = [
                'appKey' => $this->settings->appKey,
                'environment' => $this->settings->environment,
                'time' => date('c'),
                'instanceName' => $this->settings->instanceName ?? gethostname(),
                'stats' => [],
            ];

            // Get all feature keys
            $featureKeys = array_unique(array_merge(
                array_keys($statsToSend),
                array_keys($uniqueEnabledToSend),
                array_keys($uniqueDisabledToSend),
                array_keys($uniqueUsedToSend),
                array_keys($uniqueHashesToSend),
                array_keys($uniqueViewedHashesToSend)
            ));

            foreach ($featureKeys as $featureKey) {
                $stat = [
                    'feature' => $featureKey,
                    'enabledCount' => $statsToSend[$featureKey][self::STAT_TYPE_ENABLED] ?? 0,
                    'disabledCount' => $statsToSend[$featureKey][self::STAT_TYPE_DISABLED] ?? 0,
                    'uniqueContextIdentifierEnabledCount' => count($uniqueEnabledToSend[$featureKey] ?? []),
                    'uniqueContextIdentifierDisabledCount' => count($uniqueDisabledToSend[$featureKey] ?? []),
                    'uniqueRequestEnabledCount' => $statsToSend[$featureKey][self::STAT_TYPE_UNIQUE_REQUEST_ENABLED] ?? 0,
                    'uniqueRequestDisabledCount' => $statsToSend[$featureKey][self::STAT_TYPE_UNIQUE_REQUEST_DISABLED] ?? 0,
                    'usedCount' => $statsToSend[$featureKey][self::STAT_TYPE_USED] ?? 0,
                    'uniqueUsersUsedCount' => count($uniqueUsedToSend[$featureKey] ?? []),
                ];

                // Add unique user hashes (USED tracking)
                if (isset($uniqueHashesToSend[$featureKey])) {
                    $stat['uniqueUserHashes'] = $uniqueHashesToSend[$featureKey];
                }

                // Add unique viewed user hashes (VIEWED tracking)
                if (isset($uniqueViewedHashesToSend[$featureKey])) {
                    $stat['uniqueViewedUserHashes'] = $uniqueViewedHashesToSend[$featureKey];
                }

                $payload['stats'][] = $stat;
            }

            // Add application-level unique user hashes
            if (!empty($appHashesToSend)) {
                $payload['uniqueUserHashes'] = $appHashesToSend;
            }

            // Send to API
            $this->httpClient->post('api/usage/stats', $payload);

            $this->lastSend = time();
            $this->logger->debug('Statistics sent successfully');
        } catch (\Exception $e) {
            // Restore stats on error
            $this->stats = array_merge_recursive($this->stats, $statsToSend ?? []);
            $this->uniqueUsageEnabled = array_merge_recursive($this->uniqueUsageEnabled, $uniqueEnabledToSend ?? []);
            $this->uniqueUsageDisabled = array_merge_recursive($this->uniqueUsageDisabled, $uniqueDisabledToSend ?? []);
            $this->uniqueUsageUsed = array_merge_recursive($this->uniqueUsageUsed, $uniqueUsedToSend ?? []);
            $this->uniqueUserHashes = array_merge_recursive($this->uniqueUserHashes, $uniqueHashesToSend ?? []);
            $this->uniqueViewedUserHashes = array_merge_recursive($this->uniqueViewedUserHashes, $uniqueViewedHashesToSend ?? []);
            $this->applicationUniqueUserHashes = array_merge($this->applicationUniqueUserHashes, $appHashesToSend ?? []);

            $this->logger->error('Error sending stats to Toggly', ['error' => $e->getMessage()]);
        } finally {
            $this->sendInProgress = false;
        }
    }
}
