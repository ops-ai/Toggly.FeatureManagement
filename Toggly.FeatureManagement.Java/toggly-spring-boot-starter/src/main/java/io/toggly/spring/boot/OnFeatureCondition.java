package io.toggly.spring.boot;

import io.toggly.core.TogglyClient;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

import java.util.Map;

/**
 * Condition implementation for {@link ConditionalOnFeature}.
 */
public class OnFeatureCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        Map<String, Object> attributes = metadata.getAnnotationAttributes(
                ConditionalOnFeature.class.getName());

        if (attributes == null) {
            return true;
        }

        String[] featureKeys = (String[]) attributes.get("value");
        boolean matchAll = (boolean) attributes.get("matchAll");
        boolean matchIfDisabled = (boolean) attributes.get("matchIfDisabled");

        if (featureKeys == null || featureKeys.length == 0) {
            return true;
        }

        // Try to get TogglyClient from context
        TogglyClient client;
        try {
            client = context.getBeanFactory().getBean(TogglyClient.class);
        } catch (Exception e) {
            // Client not available yet, check properties for defaults
            return evaluateFromProperties(context, featureKeys, matchAll, matchIfDisabled);
        }

        boolean result;
        if (matchAll) {
            result = true;
            for (String key : featureKeys) {
                if (!client.isEnabled(key)) {
                    result = false;
                    break;
                }
            }
        } else {
            result = false;
            for (String key : featureKeys) {
                if (client.isEnabled(key)) {
                    result = true;
                    break;
                }
            }
        }

        return matchIfDisabled ? !result : result;
    }

    private boolean evaluateFromProperties(ConditionContext context, String[] featureKeys,
                                           boolean matchAll, boolean matchIfDisabled) {
        // Fall back to property-based evaluation
        boolean defaultState = Boolean.parseBoolean(
                context.getEnvironment().getProperty("toggly.default-feature-state", "false"));

        boolean result;
        if (matchAll) {
            result = true;
            for (String key : featureKeys) {
                String propKey = "toggly.feature-defaults." + key;
                boolean enabled = Boolean.parseBoolean(
                        context.getEnvironment().getProperty(propKey, String.valueOf(defaultState)));
                if (!enabled) {
                    result = false;
                    break;
                }
            }
        } else {
            result = false;
            for (String key : featureKeys) {
                String propKey = "toggly.feature-defaults." + key;
                boolean enabled = Boolean.parseBoolean(
                        context.getEnvironment().getProperty(propKey, String.valueOf(defaultState)));
                if (enabled) {
                    result = true;
                    break;
                }
            }
        }

        return matchIfDisabled ? !result : result;
    }
}
