package io.toggly.servlet;

import io.toggly.core.TogglyClient;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.model.FeatureRequirement;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class FeatureGateFilterTest {

    @AfterEach
    void clearContext() {
        ContextHolder.clear();
    }

    @Test
    void forwardsConfiguredFeaturesToTheClient() throws Exception {
        TogglyClient client = mock(TogglyClient.class);
        when(client.gate(any(), eq(FeatureRequirement.ALL), anyBoolean(), any())).thenReturn(true);
        ServletContext context = mock(ServletContext.class);
        when(context.getAttribute(TogglyServletContextListener.TOGGLY_CLIENT_ATTR)).thenReturn(client);
        FilterConfig config = mock(FilterConfig.class);
        when(config.getServletContext()).thenReturn(context);
        when(config.getInitParameter("features")).thenReturn("alpha,beta");

        FeatureGateFilter filter = new FeatureGateFilter();
        filter.init(config);
        FilterChain chain = mock(FilterChain.class);
        filter.doFilter(mock(ServletRequest.class), mock(ServletResponse.class), chain);

        verify(client).gate(eq(List.of("alpha", "beta")), eq(FeatureRequirement.ALL), eq(false), any());
        verify(chain).doFilter(any(ServletRequest.class), any(ServletResponse.class));
    }
}
