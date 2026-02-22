/**
 * Server-side Toggly client
 */

import {
  TogglyConfig,
  FeatureFlags,
  IdentityContext,
  TogglyHook,
  EvaluationSeriesData,
  IdentitySeriesData,
  mergeConfig,
  buildDefinitionsUrl,
  isFeatureEnabled,
  evaluateFeatureGate,
  fetchWithTimeout,
  createLogger,
  TogglyNetworkError,
} from '@ops-ai/remix-toggly-core';

/**
 * Server-side Toggly client for fetching and evaluating feature flags
 */
export class TogglyServerClient {
  private readonly config: TogglyConfig;
  private readonly logger: ReturnType<typeof createLogger>;
  private flags: FeatureFlags = {};
  private hooks: TogglyHook[] = [];
  private initialized = false;

  constructor(config: TogglyConfig) {
    this.config = mergeConfig(config);
    this.logger = createLogger(this.config.debug ?? false);

    if (!this.config.appKey && !this.config.featureDefaults) {
      this.logger.warn(
        'No appKey provided and no featureDefaults set. All features will be disabled.'
      );
    }
  }

  /**
   * Add a hook to the client
   */
  addHook(hook: TogglyHook): void {
    const metadata = hook.getMetadata();
    const exists = this.hooks.find((h) => h.getMetadata().name === metadata.name);

    if (exists) {
      this.logger.warn(`Hook "${metadata.name}" already registered. Skipping.`);
      return;
    }

    this.hooks.push(hook);
    this.logger.debug(`Hook "${metadata.name}" registered.`);
  }

  /**
   * Remove a hook by name
   */
  removeHook(name: string): boolean {
    const index = this.hooks.findIndex((h) => h.getMetadata().name === name);

    if (index > -1) {
      this.hooks.splice(index, 1);
      this.logger.debug(`Hook "${name}" removed.`);
      return true;
    }

    return false;
  }

  /**
   * Initialize the client by fetching feature flags
   */
  async init(identity?: string): Promise<FeatureFlags> {
    if (this.initialized && Object.keys(this.flags).length > 0) {
      this.logger.debug('Client already initialized, returning cached flags.');
      return this.flags;
    }

    // Execute beforeIdentify hooks if identity provided
    if (identity) {
      await this.executeBeforeIdentify(identity);
    }

    await this.fetchFlags(identity);
    this.initialized = true;

    // Execute afterIdentify hooks if identity provided
    if (identity) {
      await this.executeAfterIdentify(identity);
    }

    return this.flags;
  }

  /**
   * Fetch feature flags from the API
   */
  async fetchFlags(identity?: string): Promise<FeatureFlags> {
    if (!this.config.appKey) {
      this.logger.debug('No appKey, using featureDefaults.');
      this.flags = this.config.featureDefaults ?? {};
      return this.flags;
    }

    try {
      const url = buildDefinitionsUrl(this.config, identity);
      this.logger.debug(`Fetching flags from: ${url}`);

      const response = await fetchWithTimeout(url, {}, this.config.timeout);

      if (!response.ok) {
        throw new TogglyNetworkError(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const payload = await response.json();
      this.flags =
        payload && typeof payload === 'object'
          ? (payload as FeatureFlags)
          : {};
      this.logger.debug(`Fetched ${Object.keys(this.flags).length} flags.`);

      // Execute afterRefresh hooks
      await this.executeAfterRefresh(this.flags);

      return this.flags;
    } catch (error) {
      this.logger.warn('Failed to fetch flags, using featureDefaults.', error);
      this.flags = this.config.featureDefaults ?? {};
      return this.flags;
    }
  }

  /**
   * Get all flags
   */
  getFlags(): FeatureFlags {
    return { ...this.flags };
  }

  /**
   * Check if a feature is enabled
   */
  async isEnabled(
    featureKey: string,
    _context?: IdentityContext,
    defaultValue = false
  ): Promise<boolean> {
    // Execute beforeEvaluation hooks
    const hookData = await this.executeBeforeEvaluation(featureKey, defaultValue);

    const result = isFeatureEnabled(this.flags, featureKey, defaultValue);

    // Execute afterEvaluation hooks
    await this.executeAfterEvaluation(featureKey, hookData, result);

    return result;
  }

  /**
   * Check if a feature is disabled
   */
  async isDisabled(
    featureKey: string,
    context?: IdentityContext,
    defaultValue = true
  ): Promise<boolean> {
    return !(await this.isEnabled(featureKey, context, !defaultValue));
  }

  /**
   * Evaluate a feature gate (multiple features)
   */
  async evaluateGate(
    featureKeys: string[],
    requirement: 'all' | 'any' = 'all',
    negate = false,
    defaultValue = false
  ): Promise<boolean> {
    // Execute beforeEvaluation for first feature
    const firstKey = featureKeys[0] ?? 'gate';
    const hookData = await this.executeBeforeEvaluation(firstKey, defaultValue);

    const result = evaluateFeatureGate(
      this.flags,
      featureKeys,
      requirement,
      negate,
      defaultValue
    );

    // Execute afterEvaluation
    await this.executeAfterEvaluation(firstKey, hookData, result.enabled);

    return result.enabled;
  }

  /**
   * Get the server context for client hydration
   */
  getServerContext(): {
    flags: FeatureFlags;
    appKey?: string;
    environment?: string;
    fetchedAt: number;
  } {
    return {
      flags: this.flags,
      appKey: this.config.appKey,
      environment: this.config.environment,
      fetchedAt: Date.now(),
    };
  }

  // Hook execution methods

  private async executeBeforeEvaluation(
    flagKey: string,
    defaultValue?: boolean
  ): Promise<Map<string, EvaluationSeriesData | void>> {
    const dataMap = new Map<string, EvaluationSeriesData | void>();

    for (const hook of this.hooks) {
      if (hook.beforeEvaluation) {
        try {
          const data = await hook.beforeEvaluation(flagKey, defaultValue);
          dataMap.set(hook.getMetadata().name, data);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.beforeEvaluation":`,
            error
          );
        }
      }
    }

    return dataMap;
  }

  private async executeAfterEvaluation(
    flagKey: string,
    dataMap: Map<string, EvaluationSeriesData | void>,
    result: boolean
  ): Promise<void> {
    // Execute in reverse order
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterEvaluation) {
        try {
          const data = dataMap.get(hook.getMetadata().name);
          await hook.afterEvaluation(flagKey, data, result);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.afterEvaluation":`,
            error
          );
        }
      }
    }
  }

  private async executeBeforeIdentify(
    identity: string
  ): Promise<Map<string, IdentitySeriesData | void>> {
    const dataMap = new Map<string, IdentitySeriesData | void>();

    for (const hook of this.hooks) {
      if (hook.beforeIdentify) {
        try {
          const data = await hook.beforeIdentify(identity);
          dataMap.set(hook.getMetadata().name, data);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.beforeIdentify":`,
            error
          );
        }
      }
    }

    return dataMap;
  }

  private async executeAfterIdentify(identity: string): Promise<void> {
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterIdentify) {
        try {
          await hook.afterIdentify(identity, undefined);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.afterIdentify":`,
            error
          );
        }
      }
    }
  }

  private async executeAfterRefresh(flags: FeatureFlags): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterRefresh) {
        try {
          await hook.afterRefresh(flags);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.afterRefresh":`,
            error
          );
        }
      }
    }
  }
}

/**
 * Create a new server client instance
 */
export function createServerClient(config: TogglyConfig): TogglyServerClient {
  return new TogglyServerClient(config);
}
