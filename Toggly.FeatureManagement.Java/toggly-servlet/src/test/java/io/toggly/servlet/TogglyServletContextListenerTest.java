package io.toggly.servlet;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletContextEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TogglyServletContextListenerTest {

    @AfterEach
    void shutdownGlobalClient() {
        io.toggly.core.Toggly.shutdown();
    }

    @Test
    void buildsConfigurationFromServletParameters() {
        ServletContext context = mock(ServletContext.class);
        when(context.getInitParameter("toggly.appKey")).thenReturn("app-key");
        when(context.getInitParameter("toggly.environment")).thenReturn("staging");
        when(context.getInitParameter("toggly.baseUrl")).thenReturn("https://flags.example.test");
        when(context.getInitParameter("toggly.refreshIntervalSeconds")).thenReturn("45");
        when(context.getInitParameter("toggly.defaultFeatureState")).thenReturn("true");

        TogglyConfig config = new TestListener().config(context);

        assertEquals("app-key", config.getAppKey());
        assertEquals("staging", config.getEnvironment());
        assertEquals("https://flags.example.test", config.getBaseUrl());
        assertEquals(45, config.getRefreshIntervalSeconds());
        assertEquals(true, config.getDefaultFeatureState());
    }

    @Test
    void ignoresInvalidRefreshIntervalsAndLeavesAnUnconfiguredContextUntouched() {
        ServletContext context = mock(ServletContext.class);
        when(context.getInitParameter("toggly.refreshIntervalSeconds")).thenReturn("not-a-number");
        TogglyConfig config = new TestListener().config(context);

        assertEquals(180, config.getRefreshIntervalSeconds());
        assertFalse(config.getDefaultFeatureState());

        new TogglyServletContextListener().contextInitialized(new ServletContextEvent(context));
    }

    @Test
    void closesAndRemovesTheContextClientDuringShutdown() {
        ServletContext context = mock(ServletContext.class);
        TogglyClient client = mock(TogglyClient.class);
        when(context.getAttribute(TogglyServletContextListener.TOGGLY_CLIENT_ATTR)).thenReturn(client);

        new TogglyServletContextListener().contextDestroyed(new ServletContextEvent(context));

        verify(client).close();
        verify(context).removeAttribute(TogglyServletContextListener.TOGGLY_CLIENT_ATTR);
    }

    private static final class TestListener extends TogglyServletContextListener {
        TogglyConfig config(ServletContext context) {
            return createConfig(context);
        }
    }
}
