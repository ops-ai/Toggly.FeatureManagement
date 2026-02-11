package io.toggly.spring.boot;

import io.toggly.core.TogglyClient;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureRequirement;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.core.annotation.Order;

import java.lang.reflect.Method;
import java.util.Arrays;

/**
 * Aspect for processing {@link FeatureEnabled} annotations.
 *
 * <p>To enable, add {@code spring-boot-starter-aop} to your dependencies
 * and ensure component scanning includes this class.</p>
 */
@Aspect
@Order(100)
public class FeatureAspect {

    private final TogglyClient togglyClient;

    public FeatureAspect(TogglyClient togglyClient) {
        this.togglyClient = togglyClient;
    }

    @Around("@annotation(featureEnabled)")
    public Object checkFeature(ProceedingJoinPoint joinPoint, FeatureEnabled featureEnabled) throws Throwable {
        String[] features = featureEnabled.value();
        boolean matchAll = featureEnabled.matchAll();

        EvaluationContext context = ContextHolder.getContext();
        FeatureRequirement requirement = matchAll ? FeatureRequirement.ALL : FeatureRequirement.ANY;

        boolean enabled = togglyClient.gate(Arrays.asList(features), requirement, false, context);

        if (enabled) {
            return joinPoint.proceed();
        }

        // Feature disabled - try fallback
        String fallbackMethod = featureEnabled.fallbackMethod();
        if (!fallbackMethod.isEmpty()) {
            return invokeFallback(joinPoint, fallbackMethod);
        }

        // Return default value
        return getDefaultValue(joinPoint, featureEnabled.defaultValue());
    }

    private Object invokeFallback(ProceedingJoinPoint joinPoint, String fallbackMethodName) throws Throwable {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method originalMethod = signature.getMethod();
        Object target = joinPoint.getTarget();

        try {
            Method fallbackMethod = target.getClass().getMethod(
                    fallbackMethodName,
                    originalMethod.getParameterTypes());
            return fallbackMethod.invoke(target, joinPoint.getArgs());
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException(
                    "Fallback method '" + fallbackMethodName + "' not found with matching signature", e);
        }
    }

    private Object getDefaultValue(ProceedingJoinPoint joinPoint, String defaultValue) {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Class<?> returnType = signature.getReturnType();

        if (returnType == void.class || returnType == Void.class) {
            return null;
        }

        if (defaultValue.isEmpty()) {
            return getTypeDefault(returnType);
        }

        // Parse default value
        if (returnType == boolean.class || returnType == Boolean.class) {
            return Boolean.parseBoolean(defaultValue);
        }
        if (returnType == int.class || returnType == Integer.class) {
            return Integer.parseInt(defaultValue);
        }
        if (returnType == long.class || returnType == Long.class) {
            return Long.parseLong(defaultValue);
        }
        if (returnType == double.class || returnType == Double.class) {
            return Double.parseDouble(defaultValue);
        }
        if (returnType == String.class) {
            return defaultValue;
        }

        return null;
    }

    private Object getTypeDefault(Class<?> type) {
        if (type == boolean.class) return false;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        if (type == double.class) return 0.0;
        if (type == float.class) return 0.0f;
        if (type == short.class) return (short) 0;
        if (type == byte.class) return (byte) 0;
        if (type == char.class) return '\0';
        return null;
    }
}
