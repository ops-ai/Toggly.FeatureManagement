package io.toggly.core.eval;

/**
 * Best-effort User-Agent parser for segment filters.
 *
 * <p>Bit-identical trees vs ua-parser-js are not required; golden fixtures use
 * common Chrome / iPhone Safari strings.</p>
 */
public final class UserAgentParser {

    private UserAgentParser() {}

    public static final class ParsedUserAgent {
        private final String browserFamily;
        private final String osFamily;
        private final String deviceFamily;

        ParsedUserAgent(String browserFamily, String osFamily, String deviceFamily) {
            this.browserFamily = browserFamily;
            this.osFamily = osFamily;
            this.deviceFamily = deviceFamily;
        }

        public String getBrowserFamily() {
            return browserFamily;
        }

        public String getOsFamily() {
            return osFamily;
        }

        public String getDeviceFamily() {
            return deviceFamily;
        }
    }

    /**
     * Parses a User-Agent string.
     *
     * @param userAgent raw UA header
     * @return parsed fields, or null when UA is blank
     */
    public static ParsedUserAgent parse(String userAgent) {
        if (userAgent == null || userAgent.isEmpty()) {
            return null;
        }
        return new ParsedUserAgent(
                detectBrowser(userAgent),
                detectOs(userAgent),
                detectDevice(userAgent));
    }

    private static String detectBrowser(String ua) {
        if (contains(ua, "Edg/") || contains(ua, "EdgiOS/")) {
            return "Edge";
        }
        if (contains(ua, "OPR/") || contains(ua, "Opera")) {
            return "Opera";
        }
        if (contains(ua, "Chrome/") || contains(ua, "CriOS/")) {
            return "Chrome";
        }
        if (contains(ua, "Firefox/") || contains(ua, "FxiOS/")) {
            return "Firefox";
        }
        if (contains(ua, "Safari/") && contains(ua, "Version/")
                && !contains(ua, "Chrome") && !contains(ua, "Chromium")) {
            return "Safari";
        }
        return "Other";
    }

    private static String detectOs(String ua) {
        if (contains(ua, "Android")) {
            return "Android";
        }
        if (contains(ua, "iPhone") || contains(ua, "iPad") || contains(ua, "iPod")
                || contains(ua, "CPU iPhone OS") || contains(ua, "CPU OS")) {
            return "iOS";
        }
        if (contains(ua, "Mac OS X") || contains(ua, "Macintosh")) {
            return "Mac OS";
        }
        if (contains(ua, "Windows")) {
            return "Windows";
        }
        if (contains(ua, "Linux")) {
            return "Linux";
        }
        return "Other";
    }

    private static String detectDevice(String ua) {
        if (contains(ua, "iPhone")) {
            return "iPhone";
        }
        if (contains(ua, "iPad")) {
            return "iPad";
        }
        if (contains(ua, "iPod")) {
            return "iPod";
        }
        return "Other";
    }

    private static boolean contains(String haystack, String needle) {
        return haystack.contains(needle);
    }
}
