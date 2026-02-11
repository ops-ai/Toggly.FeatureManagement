package io.toggly.core.context;

/**
 * ThreadLocal-based holder for EvaluationContext.
 *
 * <p>Allows setting context once per request/thread and accessing it throughout
 * the application without passing it explicitly.</p>
 *
 * <p>Example usage:</p>
 * <pre>{@code
 * // In a servlet filter or interceptor
 * EvaluationContext context = EvaluationContext.builder()
 *     .identity(userId)
 *     .addGroup(userRole)
 *     .build();
 * ContextHolder.setContext(context);
 *
 * try {
 *     // In your service code
 *     EvaluationContext ctx = ContextHolder.getContext();
 *     boolean enabled = client.isEnabled("feature", ctx);
 * } finally {
 *     ContextHolder.clear();
 * }
 * }</pre>
 */
public final class ContextHolder {

    private static final ThreadLocal<EvaluationContext> contextHolder = new ThreadLocal<>();

    private ContextHolder() {
        // Utility class
    }

    /**
     * Sets the evaluation context for the current thread.
     *
     * @param context the evaluation context
     */
    public static void setContext(EvaluationContext context) {
        contextHolder.set(context);
    }

    /**
     * Gets the evaluation context for the current thread.
     *
     * @return the context or null if not set
     */
    public static EvaluationContext getContext() {
        return contextHolder.get();
    }

    /**
     * Gets the evaluation context or returns a default if not set.
     *
     * @param defaultContext the default context to return if not set
     * @return the context or the default
     */
    public static EvaluationContext getContextOrDefault(EvaluationContext defaultContext) {
        EvaluationContext context = contextHolder.get();
        return context != null ? context : defaultContext;
    }

    /**
     * Gets the evaluation context or returns an empty context if not set.
     *
     * @return the context or an empty context
     */
    public static EvaluationContext getContextOrEmpty() {
        return getContextOrDefault(EvaluationContext.empty());
    }

    /**
     * Clears the evaluation context for the current thread.
     *
     * <p>Should be called at the end of request processing to prevent memory leaks.</p>
     */
    public static void clear() {
        contextHolder.remove();
    }

    /**
     * Checks if a context is set for the current thread.
     *
     * @return true if a context is set
     */
    public static boolean hasContext() {
        return contextHolder.get() != null;
    }

    /**
     * Executes a runnable with the given context set.
     *
     * @param context the context to set
     * @param runnable the code to execute
     */
    public static void runWithContext(EvaluationContext context, Runnable runnable) {
        EvaluationContext previous = getContext();
        try {
            setContext(context);
            runnable.run();
        } finally {
            if (previous != null) {
                setContext(previous);
            } else {
                clear();
            }
        }
    }

    /**
     * Executes a callable with the given context set.
     *
     * @param context the context to set
     * @param callable the code to execute
     * @param <T> the return type
     * @return the result of the callable
     * @throws Exception if the callable throws
     */
    public static <T> T callWithContext(EvaluationContext context, java.util.concurrent.Callable<T> callable) throws Exception {
        EvaluationContext previous = getContext();
        try {
            setContext(context);
            return callable.call();
        } finally {
            if (previous != null) {
                setContext(previous);
            } else {
                clear();
            }
        }
    }
}
