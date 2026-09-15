package io.toggly.hosts.servlet;

import io.toggly.core.context.ContextHolder;
import io.toggly.servlet.TogglyContextFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServletHostTest {

    @Test
    void packagedServletFilterSetsAndClearsRequestContext() throws Exception {
        TogglyContextFilter filter = new TogglyContextFilter();
        filter.init(proxy(FilterConfig.class, Map.of()));

        HttpServletRequest request = proxy(HttpServletRequest.class, Map.of(
                "X-User-Id", "host-user",
                "X-User-Groups", "beta, paid"));
        ServletResponse response = proxy(ServletResponse.class, Map.of());
        AtomicBoolean chainRan = new AtomicBoolean();
        FilterChain chain = (request1, response1) -> {
            chainRan.set(true);
            assertEquals("host-user", ContextHolder.getContext().getIdentity());
            assertTrue(ContextHolder.getContext().getGroups().contains("beta"));
            assertTrue(ContextHolder.getContext().getGroups().contains("paid"));
        };

        filter.doFilter(request, response, chain);

        assertTrue(chainRan.get());
        assertFalse(ContextHolder.hasContext());
    }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, Map<String, String> headers) {
        return (T) Proxy.newProxyInstance(
                type.getClassLoader(),
                new Class<?>[]{type},
                (target, method, arguments) -> {
                    if ("getHeader".equals(method.getName())) {
                        return headers.get(arguments[0]);
                    }
                    if (method.getReturnType().equals(boolean.class)) {
                        return false;
                    }
                    if (method.getReturnType().equals(int.class)) {
                        return 0;
                    }
                    if (method.getReturnType().equals(long.class)) {
                        return 0L;
                    }
                    return null;
                });
    }
}
