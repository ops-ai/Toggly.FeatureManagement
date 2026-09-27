package io.toggly.core.eval;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UserAgentParserTest {

    @Test
    void distinguishesCommonBrowserOsAndDeviceFamilies() {
        assertThat(UserAgentParser.parse(null)).isNull();
        assertThat(UserAgentParser.parse("")).isNull();
        assertFamily("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120", "Edge", "Windows", "Other");
        assertFamily("Mozilla/5.0 (iPhone; CPU iPhone OS) EdgiOS/120", "Edge", "iOS", "iPhone");
        assertFamily("Mozilla/5.0 (Android) OPR/80 Chrome/100", "Opera", "Android", "Other");
        assertFamily("Mozilla/5.0 (Macintosh) Opera", "Opera", "Mac OS", "Other");
        assertFamily("Mozilla/5.0 (iPad; CPU OS) CriOS/100", "Chrome", "iOS", "iPad");
        assertFamily("Mozilla/5.0 (iPod; CPU OS) FxiOS/100", "Firefox", "iOS", "iPod");
        assertFamily("Mozilla/5.0 (Linux) Firefox/120", "Firefox", "Linux", "Other");
        assertFamily("Mozilla/5.0 (Mac OS X) Version/17 Safari/605", "Safari", "Mac OS", "Other");
        assertFamily("custom-agent", "Other", "Other", "Other");
    }

    private static void assertFamily(String ua, String browser, String os, String device) {
        UserAgentParser.ParsedUserAgent parsed = UserAgentParser.parse(ua);
        assertThat(parsed).isNotNull();
        assertThat(parsed.getBrowserFamily()).isEqualTo(browser);
        assertThat(parsed.getOsFamily()).isEqualTo(os);
        assertThat(parsed.getDeviceFamily()).isEqualTo(device);
    }
}
