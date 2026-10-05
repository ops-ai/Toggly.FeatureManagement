package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.exception.TogglyNetworkException;
import io.toggly.core.util.SimpleJson;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Backend-key client for targeting-list membership on {@code app.toggly.io}.
 */
public final class SegmentMembershipClient {

    private final String appKey;
    private final String baseUrl;

    public SegmentMembershipClient(TogglyConfig config) {
        this(config.getAppKey(), "https://app.toggly.io");
    }

    public SegmentMembershipClient(String appKey, String appBaseUrl) {
        if (appKey == null || appKey.isBlank()) {
            throw new IllegalArgumentException("appKey is required");
        }
        this.appKey = appKey;
        String base = appBaseUrl == null || appBaseUrl.isBlank() ? "https://app.toggly.io" : appBaseUrl;
        this.baseUrl = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }

    public String listSegments() {
        return send("GET", "/api/v2/segments", null);
    }

    public String addSegmentMembers(String segment, List<String> identifiers) {
        return send("POST", itemsPath(segment), identifiersJson(identifiers));
    }

    public String removeSegmentMembers(String segment, List<String> identifiers) {
        return send("DELETE", itemsPath(segment), identifiersJson(identifiers));
    }

    public String replaceSegmentMembers(String segment, List<String> identifiers) {
        return send("PUT", itemsPath(segment), identifiersJson(identifiers));
    }

    private String itemsPath(String segment) {
        return "/api/v2/segments/" + URLEncoder.encode(segment, StandardCharsets.UTF_8).replace("+", "%20") + "/items";
    }

    private static String identifiersJson(List<String> identifiers) {
        if (identifiers == null) {
            throw new IllegalArgumentException("identifiers is required");
        }
        List<String> cleaned = new ArrayList<>(identifiers.size());
        for (String id : identifiers) {
            if (id == null) {
                throw new IllegalArgumentException("identifiers must not contain null");
            }
            cleaned.add(id);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("identifiers", cleaned);
        return SimpleJson.serialize(body);
    }

    private String send(String method, String path, String body) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(baseUrl + path).toURL().openConnection();
            connection.setRequestMethod(method);
            connection.setRequestProperty("Authorization", appKey);
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String payload;
            if (stream == null) {
                payload = "";
            } else {
                try (InputStream in = stream) {
                    payload = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
            if (status >= 400) {
                throw new TogglyNetworkException("Segment membership " + method + " " + path + " failed: " + status);
            }
            return payload;
        } catch (TogglyNetworkException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new TogglyNetworkException("Segment membership request failed", ex);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }
}
