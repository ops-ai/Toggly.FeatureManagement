package io.toggly.spring.mvc;

import io.toggly.core.TogglyClient;
import io.toggly.core.context.ContextHolder;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;

import java.util.Map;

/**
 * Controller advice that adds feature flag information to the model.
 *
 * <p>Use in Thymeleaf or other templating engines:</p>
 * <pre>{@code
 * <div th:if="${features['new-header']}">
 *     <!-- New header content -->
 * </div>
 * }</pre>
 *
 * <p>To enable, add as a bean or scan its package:</p>
 * <pre>{@code
 * @Bean
 * public TogglyModelAttribute togglyModelAttribute(TogglyClient client) {
 *     return new TogglyModelAttribute(client);
 * }
 * }</pre>
 */
@ControllerAdvice
public class TogglyModelAttribute {

    private final TogglyClient togglyClient;

    public TogglyModelAttribute(TogglyClient togglyClient) {
        this.togglyClient = togglyClient;
    }

    /**
     * Adds all feature states to the model.
     *
     * @return map of feature key to enabled state
     */
    @ModelAttribute("features")
    public Map<String, Boolean> features() {
        return togglyClient.evaluateAll(ContextHolder.getContext());
    }
}
