package io.toggly.servlet;

import io.toggly.core.Toggly;
import io.toggly.core.TogglyClient;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.model.FeatureDefinition;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.io.PrintWriter;
import java.util.Map;

/**
 * Servlet that exposes feature flag information as JSON.
 *
 * <p>Useful for debugging or for JavaScript clients to fetch flag state.</p>
 *
 * <p>Configure in web.xml:</p>
 * <pre>{@code
 * <servlet>
 *     <servlet-name>togglyApi</servlet-name>
 *     <servlet-class>io.toggly.servlet.TogglyServlet</servlet-class>
 * </servlet>
 * <servlet-mapping>
 *     <servlet-name>togglyApi</servlet-name>
 *     <url-pattern>/api/features/*</url-pattern>
 * </servlet-mapping>
 * }</pre>
 *
 * <p>Endpoints:</p>
 * <ul>
 *     <li>GET /api/features - Returns all feature states as JSON</li>
 *     <li>GET /api/features/{key} - Returns specific feature state</li>
 *     <li>POST /api/features/refresh - Refreshes definitions</li>
 * </ul>
 */
public class TogglyServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        TogglyClient client = getClient(req.getServletContext());
        if (client == null) {
            sendError(resp, HttpServletResponse.SC_SERVICE_UNAVAILABLE, "Toggly not configured");
            return;
        }

        String pathInfo = req.getPathInfo();

        if (pathInfo == null || pathInfo.equals("/")) {
            // Return all features
            sendAllFeatures(resp, client);
        } else {
            // Return specific feature
            String featureKey = pathInfo.substring(1);
            sendFeature(resp, client, featureKey);
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        TogglyClient client = getClient(req.getServletContext());
        if (client == null) {
            sendError(resp, HttpServletResponse.SC_SERVICE_UNAVAILABLE, "Toggly not configured");
            return;
        }

        String pathInfo = req.getPathInfo();

        if ("/refresh".equals(pathInfo)) {
            client.refresh();
            sendJson(resp, "{\"status\":\"refreshed\",\"featureCount\":" +
                    client.getFeatureKeys().size() + "}");
        } else {
            sendError(resp, HttpServletResponse.SC_NOT_FOUND, "Unknown endpoint");
        }
    }

    private void sendAllFeatures(HttpServletResponse resp, TogglyClient client) throws IOException {
        Map<String, Boolean> features = client.evaluateAll(ContextHolder.getContext());

        StringBuilder json = new StringBuilder("{\"features\":{");
        boolean first = true;
        for (Map.Entry<String, Boolean> entry : features.entrySet()) {
            if (!first) json.append(",");
            json.append("\"").append(escapeJson(entry.getKey())).append("\":")
                    .append(entry.getValue());
            first = false;
        }
        json.append("},\"count\":").append(features.size()).append("}");

        sendJson(resp, json.toString());
    }

    private void sendFeature(HttpServletResponse resp, TogglyClient client, String featureKey)
            throws IOException {

        boolean enabled = client.isEnabled(featureKey, ContextHolder.getContext());
        FeatureDefinition definition = client.getFeatureDefinition(featureKey);

        StringBuilder json = new StringBuilder("{");
        json.append("\"key\":\"").append(escapeJson(featureKey)).append("\",");
        json.append("\"enabled\":").append(enabled).append(",");
        json.append("\"exists\":").append(definition != null);
        if (definition != null && definition.getFilters() != null) {
            json.append(",\"filterCount\":").append(definition.getFilters().size());
        }
        json.append("}");

        sendJson(resp, json.toString());
    }

    private void sendJson(HttpServletResponse resp, String json) throws IOException {
        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");
        PrintWriter writer = resp.getWriter();
        writer.write(json);
        writer.flush();
    }

    private void sendError(HttpServletResponse resp, int status, String message) throws IOException {
        resp.setStatus(status);
        sendJson(resp, "{\"error\":\"" + escapeJson(message) + "\"}");
    }

    private String escapeJson(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private TogglyClient getClient(ServletContext context) {
        TogglyClient client = (TogglyClient) context.getAttribute(
                TogglyServletContextListener.TOGGLY_CLIENT_ATTR);
        if (client == null && Toggly.isInitialized()) {
            client = Toggly.client();
        }
        return client;
    }
}
