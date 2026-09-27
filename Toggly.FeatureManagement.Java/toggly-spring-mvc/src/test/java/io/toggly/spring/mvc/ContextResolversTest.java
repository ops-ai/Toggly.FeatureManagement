package io.toggly.spring.mvc;

import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EvaluationContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.security.Principal;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ContextResolversTest {

    @AfterEach
    void clearContext() {
        ContextHolder.clear();
    }

    @Test
    void headerResolverUsesEmptyContextWhenNoHeadersExist() {
        EvaluationContext context = new HeaderContextResolver().resolve(new MockHttpServletRequest());

        assertSame(EvaluationContext.empty(), context);
    }

    @Test
    void headerResolverTrimsAndDeduplicatesGroups() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-User-Id", "user-7");
        request.addHeader("X-User-Groups", " admin, ,editor,admin ");

        EvaluationContext context = new HeaderContextResolver().resolve(request);

        assertEquals("user-7", context.getIdentity());
        assertEquals(Set.of("admin", "editor"), context.getGroups());
    }

    @Test
    void headerResolverHonorsCustomNamesAndEmptyValues() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Identity", "");
        request.addHeader("Roles", "");
        request.addHeader("X-User-Id", "ignored");

        EvaluationContext context = new HeaderContextResolver("Identity", "Roles").resolve(request);

        assertNull(context.getIdentity());
        assertTrue(context.getGroups().isEmpty());
    }

    @Test
    void headerResolverKeepsIdentityWhenGroupsHeaderIsAbsent() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-User-Id", "user-8");

        EvaluationContext context = new HeaderContextResolver().resolve(request);

        assertEquals("user-8", context.getIdentity());
        assertTrue(context.getGroups().isEmpty());
    }

    @Test
    void headerResolverKeepsGroupsWhenIdentityHeaderIsAbsent() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-User-Groups", "staff");

        EvaluationContext context = new HeaderContextResolver().resolve(request);

        assertNull(context.getIdentity());
        assertEquals(Set.of("staff"), context.getGroups());
    }

    @Test
    void securityResolverReturnsEmptyContextForAnonymousRequest() {
        EvaluationContext context = new SecurityContextResolver().resolve(new MockHttpServletRequest());

        assertSame(EvaluationContext.empty(), context);
    }

    @Test
    void securityResolverUsesPrincipalNameAndExtractedGroups() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setUserPrincipal(() -> "alice");

        EvaluationContext context = new SecurityContextResolver(p -> Set.of("premium", "staff"))
                .resolve(request);

        assertEquals("alice", context.getIdentity());
        assertEquals(Set.of("premium", "staff"), context.getGroups());
    }

    @Test
    void securityResolverIgnoresAbsentExtractorOrGroups() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setUserPrincipal(() -> "bob");

        assertTrue(new SecurityContextResolver().resolve(request).getGroups().isEmpty());
        assertTrue(new SecurityContextResolver(p -> null).resolve(request).getGroups().isEmpty());
        assertTrue(new SecurityContextResolver(p -> Set.of()).resolve(request).getGroups().isEmpty());
    }

    @Test
    void optionalSpringSecurityRoleResolverKeepsIdentityForNonAuthenticationPrincipal() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        Principal principal = () -> "carol";
        request.setUserPrincipal(principal);

        EvaluationContext context = SecurityContextResolver.forSpringSecurityRoles().resolve(request);

        assertEquals("carol", context.getIdentity());
        assertTrue(context.getGroups().isEmpty());
    }

    @Test
    void optionalSpringSecurityRoleResolverReadsAuthoritiesWithoutRuntimeDependency() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setUserPrincipal(new TestAuthentication(List.of(
                new TestAuthentication.Authority("ROLE_ADMIN"),
                new TestAuthentication.Authority("ROLE_EDITOR"),
                new TestAuthentication.Authority(null))));

        EvaluationContext context = SecurityContextResolver.forSpringSecurityRoles().resolve(request);

        assertEquals("security-user", context.getIdentity());
        assertEquals(Set.of("ROLE_ADMIN", "ROLE_EDITOR"), context.getGroups());
    }

    @Test
    void contextInterceptorInstallsAndClearsRequestContext() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-User-Id", "user-9");
        MockHttpServletResponse response = new MockHttpServletResponse();
        TogglyContextInterceptor interceptor = new TogglyContextInterceptor(new HeaderContextResolver());

        assertTrue(interceptor.preHandle(request, response, new Object()));
        assertEquals("user-9", ContextHolder.getContext().getIdentity());
        interceptor.afterCompletion(request, response, new Object(), null);
        assertFalse(ContextHolder.hasContext());
    }

    @Test
    void contextInterceptorWithoutResolverInstallsEmptyContext() {
        TogglyContextInterceptor interceptor = new TogglyContextInterceptor(null);
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertTrue(interceptor.preHandle(request, response, new Object()));
        assertSame(EvaluationContext.empty(), ContextHolder.getContext());
    }
}
