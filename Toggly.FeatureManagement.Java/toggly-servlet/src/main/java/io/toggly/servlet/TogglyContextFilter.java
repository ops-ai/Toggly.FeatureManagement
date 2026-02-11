package io.toggly.servlet;

import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EvaluationContext;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;

import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Servlet filter that sets up the evaluation context for each request.
 *
 * <p>Configure in web.xml:</p>
 * <pre>{@code
 * <filter>
 *     <filter-name>togglyContext</filter-name>
 *     <filter-class>io.toggly.servlet.TogglyContextFilter</filter-class>
 *     <init-param>
 *         <param-name>identityHeader</param-name>
 *         <param-value>X-User-Id</param-value>
 *     </init-param>
 *     <init-param>
 *         <param-name>groupsHeader</param-name>
 *         <param-value>X-User-Groups</param-value>
 *     </init-param>
 * </filter>
 * <filter-mapping>
 *     <filter-name>togglyContext</filter-name>
 *     <url-pattern>/*</url-pattern>
 * </filter-mapping>
 * }</pre>
 */
public class TogglyContextFilter implements Filter {

    private String identityHeader = "X-User-Id";
    private String groupsHeader = "X-User-Groups";
    private boolean useSecurityPrincipal = true;

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {
        String identityHeaderParam = filterConfig.getInitParameter("identityHeader");
        if (identityHeaderParam != null && !identityHeaderParam.isEmpty()) {
            this.identityHeader = identityHeaderParam;
        }

        String groupsHeaderParam = filterConfig.getInitParameter("groupsHeader");
        if (groupsHeaderParam != null && !groupsHeaderParam.isEmpty()) {
            this.groupsHeader = groupsHeaderParam;
        }

        String useSecurityParam = filterConfig.getInitParameter("useSecurityPrincipal");
        if (useSecurityParam != null) {
            this.useSecurityPrincipal = Boolean.parseBoolean(useSecurityParam);
        }
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        try {
            EvaluationContext context = createContext(request);
            ContextHolder.setContext(context);
            chain.doFilter(request, response);
        } finally {
            ContextHolder.clear();
        }
    }

    /**
     * Creates the evaluation context from the request.
     *
     * <p>Override this method for custom context extraction.</p>
     *
     * @param request the servlet request
     * @return the evaluation context
     */
    protected EvaluationContext createContext(ServletRequest request) {
        if (!(request instanceof HttpServletRequest)) {
            return EvaluationContext.empty();
        }

        HttpServletRequest httpRequest = (HttpServletRequest) request;
        EvaluationContext.Builder builder = EvaluationContext.builder();

        // Try headers first
        String identity = httpRequest.getHeader(identityHeader);

        // Fall back to security principal
        if ((identity == null || identity.isEmpty()) && useSecurityPrincipal) {
            if (httpRequest.getUserPrincipal() != null) {
                identity = httpRequest.getUserPrincipal().getName();
            }
        }

        if (identity != null && !identity.isEmpty()) {
            builder.identity(identity);
        }

        // Parse groups
        String groupsStr = httpRequest.getHeader(groupsHeader);
        if (groupsStr != null && !groupsStr.isEmpty()) {
            Set<String> groups = new HashSet<>();
            Arrays.stream(groupsStr.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .forEach(groups::add);
            builder.groups(groups);
        }

        return builder.build();
    }

    @Override
    public void destroy() {
        // No cleanup needed
    }
}
