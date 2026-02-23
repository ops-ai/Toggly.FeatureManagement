// src/index.ts
import {
  TogglyError,
  TogglyNetworkError as TogglyNetworkError2,
  TogglyConfigError,
  TogglyTimeoutError,
  TOGGLY_LOADER_KEY as TOGGLY_LOADER_KEY2,
  HEADERS as HEADERS2,
  STORAGE_KEYS as STORAGE_KEYS2
} from "@ops-ai/remix-toggly-core";

// src/client.ts
import {
  mergeConfig,
  buildDefinitionsUrl,
  isFeatureEnabled,
  evaluateFeatureGate,
  fetchWithTimeout,
  createLogger,
  TogglyNetworkError
} from "@ops-ai/remix-toggly-core";
var TogglyServerClient = class {
  constructor(config) {
    this.flags = {};
    this.hooks = [];
    this.initialized = false;
    this.config = mergeConfig(config);
    this.logger = createLogger(this.config.debug ?? false);
    if (!this.config.appKey && !this.config.featureDefaults) {
      this.logger.warn(
        "No appKey provided and no featureDefaults set. All features will be disabled."
      );
    }
  }
  /**
   * Add a hook to the client
   */
  addHook(hook) {
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
  removeHook(name) {
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
  async init(identity) {
    if (this.initialized && Object.keys(this.flags).length > 0) {
      this.logger.debug("Client already initialized, returning cached flags.");
      return this.flags;
    }
    if (identity) {
      await this.executeBeforeIdentify(identity);
    }
    await this.fetchFlags(identity);
    this.initialized = true;
    if (identity) {
      await this.executeAfterIdentify(identity);
    }
    return this.flags;
  }
  /**
   * Fetch feature flags from the API
   */
  async fetchFlags(identity) {
    if (!this.config.appKey) {
      this.logger.debug("No appKey, using featureDefaults.");
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
      if (payload && typeof payload === "object" && "defs" in payload) {
        this.flags = payload.defs ?? {};
      } else {
        this.flags = payload && typeof payload === "object" ? payload : {};
      }
      this.logger.debug(`Fetched ${Object.keys(this.flags).length} flags.`);
      await this.executeAfterRefresh(this.flags);
      return this.flags;
    } catch (error) {
      this.logger.warn("Failed to fetch flags, using featureDefaults.", error);
      this.flags = this.config.featureDefaults ?? {};
      return this.flags;
    }
  }
  /**
   * Get all flags
   */
  getFlags() {
    return { ...this.flags };
  }
  /**
   * Check if a feature is enabled
   */
  async isEnabled(featureKey, _context, defaultValue = false) {
    const hookData = await this.executeBeforeEvaluation(featureKey, defaultValue);
    const result = isFeatureEnabled(this.flags, featureKey, defaultValue);
    await this.executeAfterEvaluation(featureKey, hookData, result);
    return result;
  }
  /**
   * Check if a feature is disabled
   */
  async isDisabled(featureKey, context, defaultValue = true) {
    return !await this.isEnabled(featureKey, context, !defaultValue);
  }
  /**
   * Evaluate a feature gate (multiple features)
   */
  async evaluateGate(featureKeys, requirement = "all", negate = false, defaultValue = false) {
    const firstKey = featureKeys[0] ?? "gate";
    const hookData = await this.executeBeforeEvaluation(firstKey, defaultValue);
    const result = evaluateFeatureGate(
      this.flags,
      featureKeys,
      requirement,
      negate,
      defaultValue
    );
    await this.executeAfterEvaluation(firstKey, hookData, result.enabled);
    return result.enabled;
  }
  /**
   * Get the server context for client hydration
   */
  getServerContext() {
    return {
      flags: this.flags,
      appKey: this.config.appKey,
      environment: this.config.environment,
      fetchedAt: Date.now()
    };
  }
  // Hook execution methods
  async executeBeforeEvaluation(flagKey, defaultValue) {
    const dataMap = /* @__PURE__ */ new Map();
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
  async executeAfterEvaluation(flagKey, dataMap, result) {
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
  async executeBeforeIdentify(identity) {
    const dataMap = /* @__PURE__ */ new Map();
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
  async executeAfterIdentify(identity) {
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterIdentify) {
        try {
          await hook.afterIdentify(identity, void 0);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.afterIdentify":`,
            error
          );
        }
      }
    }
  }
  async executeAfterRefresh(flags) {
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
};
function createServerClient(config) {
  return new TogglyServerClient(config);
}

// src/loader.ts
import {
  TOGGLY_LOADER_KEY,
  parseIdentity,
  HEADERS,
  STORAGE_KEYS
} from "@ops-ai/remix-toggly-core";
function createTogglyLoader(options) {
  const client = createServerClient(options);
  return {
    /**
     * Get the Toggly client
     */
    getClient() {
      return client;
    },
    /**
     * Load feature flags for a loader function
     */
    async load(args) {
      const { request } = args;
      let identity;
      if (options.getIdentity) {
        identity = await options.getIdentity(request);
      } else {
        identity = getIdentityFromRequest(request, options.getIdentityFromCookies);
      }
      await client.init(identity);
      return {
        flags: client.getFlags(),
        identity,
        appKey: options.appKey,
        environment: options.environment,
        fetchedAt: Date.now()
      };
    },
    /**
     * Create loader data with feature context
     */
    async getLoaderData(args, additionalData) {
      const context = await this.load(args);
      return {
        ...additionalData,
        [TOGGLY_LOADER_KEY]: context
      };
    },
    /**
     * Check if a feature is enabled
     */
    async isEnabled(featureKey, defaultValue = false) {
      return client.isEnabled(featureKey, void 0, defaultValue);
    },
    /**
     * Check if a feature is disabled
     */
    async isDisabled(featureKey, defaultValue = true) {
      return client.isDisabled(featureKey, void 0, defaultValue);
    },
    /**
     * Evaluate a feature gate
     */
    async evaluateGate(featureKeys, requirement = "all", negate = false) {
      return client.evaluateGate(featureKeys, requirement, negate);
    },
    /**
     * Get all flags
     */
    getFlags() {
      return client.getFlags();
    }
  };
}
function getIdentityFromRequest(request, customCookieParser) {
  const headerIdentity = request.headers.get(HEADERS.IDENTITY);
  if (headerIdentity) {
    return parseIdentity(headerIdentity);
  }
  const cookies = request.headers.get("cookie");
  if (customCookieParser) {
    return customCookieParser(cookies);
  }
  if (cookies) {
    const identity = parseCookie(cookies, STORAGE_KEYS.IDENTITY);
    if (identity) {
      return parseIdentity(identity);
    }
  }
  return void 0;
}
function parseCookie(cookies, name) {
  const pairs = cookies.split(";");
  for (const pair of pairs) {
    const [key, value] = pair.trim().split("=");
    if (key === name && value) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return void 0;
}
async function getFeatureFlags(request, options) {
  const loader = createTogglyLoader(options);
  return loader.load({ request, params: {}, context: {} });
}
async function isFeatureEnabled2(request, featureKey, options, defaultValue = false) {
  const loader = createTogglyLoader(options);
  await loader.load({ request, params: {}, context: {} });
  return loader.isEnabled(featureKey, defaultValue);
}

// src/action.ts
import { json, redirect } from "@remix-run/server-runtime";
function createFeatureGatedAction(options, handler) {
  return async (args) => {
    const { request } = args;
    const client = createServerClient(options);
    let identity;
    if (options.getIdentity) {
      identity = await options.getIdentity(request);
    }
    await client.init(identity);
    const togglyContext = {
      client,
      flags: client.getFlags(),
      isEnabled: (key, def) => client.isEnabled(key, void 0, def),
      isDisabled: (key, def) => client.isDisabled(key, void 0, def),
      evaluateGate: (keys, req, neg) => client.evaluateGate(keys, req, neg)
    };
    if (options.requiredFeatures) {
      const featureKeys = Array.isArray(options.requiredFeatures) ? options.requiredFeatures : [options.requiredFeatures];
      const requirement = options.requirement ?? "all";
      const isAllowed = await client.evaluateGate(featureKeys, requirement);
      if (!isAllowed) {
        if (options.onFeatureDisabled) {
          return options.onFeatureDisabled(request, featureKeys);
        }
        if (options.redirectTo) {
          return redirect(options.redirectTo);
        }
        return json(
          {
            error: options.errorMessage ?? "Feature is not available",
            featureKeys
          },
          { status: options.errorStatus ?? 403 }
        );
      }
    }
    return handler(args, togglyContext);
  };
}
function createTogglyAction(options) {
  const client = createServerClient(options);
  return {
    /**
     * Get the Toggly client
     */
    getClient() {
      return client;
    },
    /**
     * Initialize for an action request
     */
    async init(request) {
      let identity;
      if (options.getIdentity) {
        identity = await options.getIdentity(request);
      }
      await client.init(identity);
      return {
        client,
        flags: client.getFlags(),
        isEnabled: (key, def) => client.isEnabled(key, void 0, def),
        isDisabled: (key, def) => client.isDisabled(key, void 0, def),
        evaluateGate: (keys, req, neg) => client.evaluateGate(keys, req, neg)
      };
    },
    /**
     * Wrap an action with feature checks
     */
    requireFeature(featureKey, handler, onDisabled) {
      return createFeatureGatedAction(
        {
          ...options,
          requiredFeatures: featureKey,
          onFeatureDisabled: onDisabled
        },
        handler
      );
    },
    /**
     * Wrap an action with feature gate checks
     */
    requireFeatures(featureKeys, requirement, handler, onDisabled) {
      return createFeatureGatedAction(
        {
          ...options,
          requiredFeatures: featureKeys,
          requirement,
          onFeatureDisabled: onDisabled
        },
        handler
      );
    }
  };
}
function requireFeature(featureKey, options, onDisabled) {
  return function(handler) {
    return createFeatureGatedAction(
      {
        ...options,
        requiredFeatures: featureKey,
        onFeatureDisabled: onDisabled ? () => onDisabled() : void 0
      },
      handler
    );
  };
}
export {
  HEADERS2 as HEADERS,
  STORAGE_KEYS2 as STORAGE_KEYS,
  TOGGLY_LOADER_KEY2 as TOGGLY_LOADER_KEY,
  TogglyConfigError,
  TogglyError,
  TogglyNetworkError2 as TogglyNetworkError,
  TogglyServerClient,
  TogglyTimeoutError,
  createFeatureGatedAction,
  createServerClient,
  createTogglyAction,
  createTogglyLoader,
  getFeatureFlags,
  isFeatureEnabled2 as isFeatureEnabled,
  requireFeature
};
//# sourceMappingURL=index.js.map