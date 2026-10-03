package io.toggly.servlet;

import io.toggly.core.context.ContextHolder;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.security.Principal;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TogglyContextFilterTest {

    @AfterEach
    void clearContext() {
        ContextHolder.clear();
    }

    @Test
    void buildsContextFromConfiguredHeadersAndClearsItAfterTheRequest() throws Exception {
        FilterConfig config = mock(FilterConfig.class);
        when(config.getInitParameter("identityHeader")).thenReturn("X-Account");
        when(config.getInitParameter("groupsHeader")).thenReturn("X-Roles");
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Account")).thenReturn("account-42");
        when(request.getHeader("X-Roles")).thenReturn("admin, beta, admin, ");
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            assertEquals("account-42", ContextHolder.getContext().getIdentity());
            assertEquals(Set.of("admin", "beta"), ContextHolder.getContext().getGroups());
            return null;
        }).when(chain).doFilter(any(ServletRequest.class), any(ServletResponse.class));

        TogglyContextFilter filter = new TogglyContextFilter();
        filter.init(config);
        filter.doFilter(request, mock(ServletResponse.class), chain);

        verify(chain).doFilter(any(ServletRequest.class), any(ServletResponse.class));
        assertNull(ContextHolder.getContext());
    }

    @Test
    void usesTheSecurityPrincipalWhenTheIdentityHeaderIsMissing() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        Principal principal = () -> "principal-7";
        when(request.getUserPrincipal()).thenReturn(principal);
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            assertEquals("principal-7", ContextHolder.getContext().getIdentity());
            return null;
        }).when(chain).doFilter(any(ServletRequest.class), any(ServletResponse.class));

        TogglyContextFilter filter = new TogglyContextFilter();
        filter.init(mock(FilterConfig.class));
        filter.doFilter(request, mock(ServletResponse.class), chain);
    }

    @Test
    void usesAnEmptyContextForNonHttpRequests() throws Exception {
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            assertNull(ContextHolder.getContext().getIdentity());
            assertEquals(Set.of(), ContextHolder.getContext().getGroups());
            return null;
        }).when(chain).doFilter(any(ServletRequest.class), any(ServletResponse.class));

        TogglyContextFilter filter = new TogglyContextFilter();
        filter.init(mock(FilterConfig.class));
        filter.doFilter(mock(ServletRequest.class), mock(ServletResponse.class), chain);
    }

    @Test
    void usesTheSecurityPrincipalWhenTheIdentityHeaderIsEmpty() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("X-User-Id")).thenReturn("");
        when(request.getUserPrincipal()).thenReturn(() -> "principal-empty-header");

        assertRequestIdentity(request, mock(FilterConfig.class), "principal-empty-header");
    }

    @Test
    void leavesIdentityUnsetWhenNoPrincipalIsAvailable() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);

        assertRequestIdentity(request, mock(FilterConfig.class), null);
    }

    @Test
    void leavesIdentityUnsetWhenPrincipalFallbackIsDisabled() throws Exception {
        FilterConfig config = mock(FilterConfig.class);
        when(config.getInitParameter("useSecurityPrincipal")).thenReturn("false");
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getUserPrincipal()).thenReturn(() -> "ignored-principal");

        assertRequestIdentity(request, config, null);

        verify(request, never()).getUserPrincipal();
    }

    private void assertRequestIdentity(HttpServletRequest request, FilterConfig config,
                                       String expectedIdentity) throws Exception {
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            assertEquals(expectedIdentity, ContextHolder.getContext().getIdentity());
            return null;
        }).when(chain).doFilter(any(ServletRequest.class), any(ServletResponse.class));
        TogglyContextFilter filter = new TogglyContextFilter();
        filter.init(config);

        filter.doFilter(request, mock(ServletResponse.class), chain);

        verify(chain).doFilter(any(ServletRequest.class), any(ServletResponse.class));
        assertNull(ContextHolder.getContext());
    }
}
