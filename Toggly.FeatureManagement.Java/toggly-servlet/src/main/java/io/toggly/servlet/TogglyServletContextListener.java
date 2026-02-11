package io.toggly.servlet;

import io.toggly.core.Toggly;
import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;

/**
 * Servlet context listener that initializes and shuts down Toggly.
 *
 * <p>Configure in web.xml or via annotation:</p>
 * <pre>{@code
 * <listener>
 *     <listener-class>io.toggly.servlet.TogglyServletContextListener</listener-class>
 * </listener>
 *
 * <context-param>
 *     <param-name>toggly.appKey</param-name>
 *     <param-value>your-app-key</param-value>
 * </context-param>
 * }</pre>
 *
 * <p>Or create a subclass for programmatic configuration:</p>
 * <pre>{@code
 * @WebListener
 * public class MyTogglyListener extends TogglyServletContextListener {
 *     @Override
 *     protected TogglyConfig createConfig(ServletContext context) {
 *         return TogglyConfig.builder()
 *             .appKey(System.getenv("TOGGLY_APP_KEY"))
 *             .environment("Production")
 *             .build();
 *     }
 * }
 * }</pre>
 */
public class TogglyServletContextListener implements ServletContextListener {

    /**
     * Servlet context attribute key for TogglyClient.
     */
    public static final String TOGGLY_CLIENT_ATTR = TogglyClient.class.getName();

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        ServletContext context = sce.getServletContext();
        TogglyConfig config = createConfig(context);

        if (config.getAppKey() != null && !config.getAppKey().isEmpty()) {
            TogglyClient client = new TogglyClient(config);
            context.setAttribute(TOGGLY_CLIENT_ATTR, client);
            Toggly.initialize(client);
        }
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        ServletContext context = sce.getServletContext();
        TogglyClient client = (TogglyClient) context.getAttribute(TOGGLY_CLIENT_ATTR);

        if (client != null) {
            client.close();
            context.removeAttribute(TOGGLY_CLIENT_ATTR);
        }

        Toggly.shutdown();
    }

    /**
     * Creates the TogglyConfig from servlet context parameters.
     *
     * <p>Override this method for custom configuration.</p>
     *
     * @param context the servlet context
     * @return the configuration
     */
    protected TogglyConfig createConfig(ServletContext context) {
        TogglyConfig.Builder builder = TogglyConfig.builder();

        String appKey = getParameter(context, "toggly.appKey");
        if (appKey != null) {
            builder.appKey(appKey);
        }

        String environment = getParameter(context, "toggly.environment");
        if (environment != null) {
            builder.environment(environment);
        }

        String baseUrl = getParameter(context, "toggly.baseUrl");
        if (baseUrl != null) {
            builder.baseUrl(baseUrl);
        }

        String refreshInterval = getParameter(context, "toggly.refreshIntervalSeconds");
        if (refreshInterval != null) {
            try {
                builder.refreshIntervalSeconds(Long.parseLong(refreshInterval));
            } catch (NumberFormatException ignored) {
            }
        }

        String defaultState = getParameter(context, "toggly.defaultFeatureState");
        if (defaultState != null) {
            builder.defaultFeatureState(Boolean.parseBoolean(defaultState));
        }

        return builder.build();
    }

    private String getParameter(ServletContext context, String name) {
        String value = context.getInitParameter(name);
        if (value == null || value.isEmpty()) {
            // Try environment variable
            String envName = name.toUpperCase().replace(".", "_");
            value = System.getenv(envName);
        }
        return value;
    }
}
