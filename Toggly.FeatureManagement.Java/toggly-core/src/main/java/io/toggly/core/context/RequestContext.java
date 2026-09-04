package io.toggly.core.context;

import java.util.Objects;

/**
 * HTTP request fields used by segment identity filters
 * (BrowserFamily, BrowserLanguage, Country, DeviceType, OS).
 */
public final class RequestContext {

    private final String userAgent;
    private final String acceptLanguage;
    private final String country;

    private RequestContext(String userAgent, String acceptLanguage, String country) {
        this.userAgent = userAgent;
        this.acceptLanguage = acceptLanguage;
        this.country = country;
    }

    /**
     * Creates a request context.
     *
     * @param userAgent User-Agent header value
     * @param acceptLanguage Accept-Language header value
     * @param country country code (e.g. from CF-IPCountry)
     * @return a new request context
     */
    public static RequestContext of(String userAgent, String acceptLanguage, String country) {
        return new RequestContext(userAgent, acceptLanguage, country);
    }

    public static Builder builder() {
        return new Builder();
    }

    public String getUserAgent() {
        return userAgent;
    }

    public String getAcceptLanguage() {
        return acceptLanguage;
    }

    public String getCountry() {
        return country;
    }

    public static final class Builder {
        private String userAgent;
        private String acceptLanguage;
        private String country;

        private Builder() {}

        public Builder userAgent(String userAgent) {
            this.userAgent = userAgent;
            return this;
        }

        public Builder acceptLanguage(String acceptLanguage) {
            this.acceptLanguage = acceptLanguage;
            return this;
        }

        public Builder country(String country) {
            this.country = country;
            return this;
        }

        public RequestContext build() {
            return new RequestContext(userAgent, acceptLanguage, country);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        RequestContext that = (RequestContext) o;
        return Objects.equals(userAgent, that.userAgent)
                && Objects.equals(acceptLanguage, that.acceptLanguage)
                && Objects.equals(country, that.country);
    }

    @Override
    public int hashCode() {
        return Objects.hash(userAgent, acceptLanguage, country);
    }

    @Override
    public String toString() {
        return "RequestContext{"
                + "userAgent='" + userAgent + '\''
                + ", acceptLanguage='" + acceptLanguage + '\''
                + ", country='" + country + '\''
                + '}';
    }
}
