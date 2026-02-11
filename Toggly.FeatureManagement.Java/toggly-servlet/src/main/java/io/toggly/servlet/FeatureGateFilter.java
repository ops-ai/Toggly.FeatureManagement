package io.toggly.servlet;

import io.toggly.core.Toggly;
import io.toggly.core.TogglyClient;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.model.FeatureRequirement;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

/**
 * Servlet filter that gates URLs based on feature flags.
 *
 * <p>Configure in web.xml:</p>
 * <pre>{@code
 * <filter>
 *     <filter-name>betaFeatureGate</filter-name>
 *     <filter-class>io.toggly.servlet.FeatureGateFilter</filter-class>
 *     <init-param>
 *         <param-name>features</param-name>
 *         <param-value>beta-feature</param-value>
 *     </init-param>
 * </filter>
 * <filter-mapping>
 *     <filter-name>betaFeatureGate</filter-name>
 *     <url-pattern>/beta/*</url-pattern>
 * </filter-mapping>
 * }</pre>
 */
public class FeatureGateFilter implements Filter {

    private List<String> features;
    private FeatureRequirement requirement = FeatureRequirement.ALL;
    private boolean negate = false;
    private int blockedStatus = HttpServletResponse.SC_NOT_FOUND;
    private TogglyClient client;

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {
        // Parse features
        String featuresParam = filterConfig.getInitParameter("features");
        if (featuresParam != null && !featuresParam.isEmpty()) {
            features = Arrays.asList(featuresParam.split(","));
        } else {
            features = List.of();
        }

        // Parse requirement
        String requirementParam = filterConfig.getInitParameter("requirement");
        if ("ANY".equalsIgnoreCase(requirementParam)) {
            requirement = FeatureRequirement.ANY;
        }

        // Parse negate
        String negateParam = filterConfig.getInitParameter("negate");
        if (negateParam != null) {
            negate = Boolean.parseBoolean(negateParam);
        }

        // Parse blocked status
        String statusParam = filterConfig.getInitParameter("blockedStatus");
        if (statusParam != null) {
            try {
                blockedStatus = Integer.parseInt(statusParam);
            } catch (NumberFormatException ignored) {
            }
        }

        // Get client from context or global
        ServletContext context = filterConfig.getServletContext();
        client = (TogglyClient) context.getAttribute(TogglyServletContextListener.TOGGLY_CLIENT_ATTR);
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {

        if (features.isEmpty()) {
            chain.doFilter(request, response);
            return;
        }

        TogglyClient effectiveClient = client;
        if (effectiveClient == null && Toggly.isInitialized()) {
            effectiveClient = Toggly.client();
        }

        if (effectiveClient == null) {
            // No client available - pass through
            chain.doFilter(request, response);
            return;
        }

        boolean allowed = effectiveClient.gate(
                features,
                requirement,
                negate,
                ContextHolder.getContext());

        if (allowed) {
            chain.doFilter(request, response);
        } else {
            if (response instanceof HttpServletResponse) {
                ((HttpServletResponse) response).sendError(blockedStatus);
            }
        }
    }

    @Override
    public void destroy() {
        // No cleanup needed
    }
}
