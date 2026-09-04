package io.toggly.core.context;

import java.util.Locale;
import java.util.Map;

/**
 * Maps common HTTP request headers into {@link RequestContext} fields.
 *
 * <p>Does not invent identity, groups, or claims — merge those separately.</p>
 */
public final class HttpRequestMapper {

    private HttpRequestMapper() {}

    /**
     * Builds a {@link RequestContext} from a header bag (case-insensitive keys).
     *
     * @param headers header name → value (first value wins for multi-valued maps)
     * @return request context with mapped fields (any may be null)
     */
    public static RequestContext fromHttpHeaders(Map<String, String> headers) {
        if (headers == null || headers.isEmpty()) {
            return RequestContext.of(null, null, null);
        }
        return RequestContext.builder()
                .userAgent(header(headers, "user-agent"))
                .acceptLanguage(header(headers, "accept-language"))
                .country(firstPresent(headers,
                        "cf-ipcountry",
                        "x-vercel-ip-country",
                        "cloudfront-viewer-country"))
                .build();
    }

    /**
     * Merges HTTP-mapped request fields over an existing evaluation context.
     *
     * @param headers HTTP headers
     * @param base existing context (identity/groups/claims/traits/entity preserved)
     * @return a new context with {@code request} set from headers
     */
    public static EvaluationContext mergeInto(Map<String, String> headers, EvaluationContext base) {
        RequestContext request = fromHttpHeaders(headers);
        if (base == null) {
            return EvaluationContext.builder().request(request).build();
        }
        return base.withRequest(request);
    }

    private static String firstPresent(Map<String, String> headers, String... names) {
        for (String name : names) {
            String value = header(headers, name);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private static String header(Map<String, String> headers, String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null
                    && entry.getKey().toLowerCase(Locale.ROOT).equals(lower)) {
                String value = entry.getValue();
                if (value != null && !value.isEmpty()) {
                    return value;
                }
            }
        }
        return null;
    }
}
