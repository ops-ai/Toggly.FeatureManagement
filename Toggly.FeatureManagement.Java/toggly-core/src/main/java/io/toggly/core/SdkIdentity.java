package io.toggly.core;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * SDK identity constants for HTTP User-Agent and WebSocket query parameters.
 */
public final class SdkIdentity {

    public static final String SDK_ID = "java";
    public static final String SDK_VERSION = "1.0.1";

    private SdkIdentity() {
    }

    public static String userAgent() {
        return "toggly-" + SDK_ID + "/" + SDK_VERSION;
    }

    public static String appendSdkQueryParams(String wsUrl, String cachedRevision) {
        Map<String, String> params = new LinkedHashMap<>();
        if (cachedRevision != null && !cachedRevision.isEmpty()) {
            params.put("rev", cachedRevision);
        }
        params.put("sdk", SDK_ID);
        params.put("sdkVersion", SDK_VERSION);

        String query = params.entrySet().stream()
                .map(entry -> URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8)
                        + "="
                        + URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));

        return wsUrl + "?" + query;
    }
}
