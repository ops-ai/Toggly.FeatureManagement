package io.toggly.spring.mvc;

import io.toggly.core.context.EvaluationContext;
import jakarta.servlet.http.HttpServletRequest;

/**
 * Interface for resolving evaluation context from HTTP requests.
 */
@FunctionalInterface
public interface ContextResolver {

    /**
     * Resolves the evaluation context from an HTTP request.
     *
     * @param request the HTTP request
     * @return the evaluation context (never null, return empty context if no info available)
     */
    EvaluationContext resolve(HttpServletRequest request);
}
