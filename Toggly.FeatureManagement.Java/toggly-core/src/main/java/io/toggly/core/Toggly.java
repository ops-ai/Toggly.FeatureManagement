package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EntityContextRegistry;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.context.TogglyEntityContext;
import io.toggly.core.exception.TogglyException;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Static facade for Toggly feature flags.
 *
 * <p>Provides convenient static methods for common operations when
 * using a single global TogglyClient instance.</p>
 *
 * <h2>Initialization:</h2>
 * <pre>{@code
 * TogglyConfig config = TogglyConfig.builder()
 *     .appKey("your-app-key")
 *     .build();
 *
 * Toggly.initialize(config);
 * }</pre>
 *
 * <h2>Usage:</h2>
 * <pre>{@code
 * if (Toggly.isEnabled("my-feature")) {
 *     // Feature is enabled
 * }
 *
 * // With context
 * Toggly.withContext(context, () -> {
 *     if (Toggly.isEnabled("my-feature")) {
 *         // Evaluated with context
 *     }
 * });
 * }</pre>
 */
public final class Toggly {

    private static final AtomicReference<TogglyClient> CLIENT = new AtomicReference<>();

    private Toggly() {
        // Static utility class
    }

    /**
     * Initializes the global Toggly client.
     *
     * @param config the Toggly configuration
     */
    public static void initialize(TogglyConfig config) {
        TogglyClient newClient = new TogglyClient(config);
        TogglyClient oldClient = CLIENT.getAndSet(newClient);
        if (oldClient != null) {
            oldClient.close();
        }
    }

    /**
     * Initializes the global Toggly client.
     *
     * @param client the TogglyClient instance
     */
    public static void initialize(TogglyClient client) {
        TogglyClient oldClient = CLIENT.getAndSet(client);
        if (oldClient != null) {
            oldClient.close();
        }
    }

    /**
     * Gets the global client instance.
     *
     * @return the client
     * @throws TogglyException if not initialized
     */
    public static TogglyClient client() {
        TogglyClient client = CLIENT.get();
        if (client == null) {
            throw new TogglyException("Toggly not initialized. Call Toggly.initialize() first.");
        }
        return client;
    }

    /**
     * Checks if a feature is enabled.
     *
     * @param featureKey the feature key
     * @return true if enabled
     */
    public static boolean isEnabled(String featureKey) {
        return client().isEnabled(featureKey);
    }

    /**
     * Checks if a feature is enabled with context.
     *
     * @param featureKey the feature key
     * @param context the evaluation context
     * @return true if enabled
     */
    public static boolean isEnabled(String featureKey, EvaluationContext context) {
        return client().isEnabled(featureKey, context);
    }

    /**
     * Registers a mapper from a domain object to {@link TogglyEntityContext}.
     */
    public static void registerContext(String kind, java.util.function.Function<Object, TogglyEntityContext> mapper) {
        EntityContextRegistry.registerContext(kind, mapper);
    }

    public static void registerContext(
            String kind,
            java.util.function.Function<Object, TogglyEntityContext> mapper,
            EntityContextRegistry.EntityContextSchemaRegistration schema) {
        EntityContextRegistry.registerContext(kind, mapper, schema);
    }

    /**
     * Executes code with the specified context.
     *
     * @param context the evaluation context
     * @param action the code to execute
     */
    public static void withContext(EvaluationContext context, Runnable action) {
        EvaluationContext previous = ContextHolder.getContext();
        try {
            ContextHolder.setContext(context);
            action.run();
        } finally {
            ContextHolder.setContext(previous);
        }
    }

    /**
     * Sets the current thread's evaluation context.
     *
     * @param context the context
     */
    public static void setContext(EvaluationContext context) {
        ContextHolder.setContext(context);
    }

    /**
     * Clears the current thread's evaluation context.
     */
    public static void clearContext() {
        ContextHolder.clear();
    }

    /**
     * Refreshes the feature definitions.
     */
    public static void refresh() {
        client().refresh();
    }

    /**
     * Shuts down the global client.
     */
    public static void shutdown() {
        TogglyClient client = CLIENT.getAndSet(null);
        if (client != null) {
            client.close();
        }
    }

    /**
     * Checks if Toggly has been initialized.
     *
     * @return true if initialized
     */
    public static boolean isInitialized() {
        return CLIENT.get() != null;
    }
}
