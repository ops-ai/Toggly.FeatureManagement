//! Best-effort User-Agent parsing for segment filters.

/// Best-effort User-Agent parse result for segment filters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedUserAgent {
    /// Browser family label (Chrome, Firefox, Safari, Edge, Opera, Other).
    pub browser_family: String,
    /// OS family label (Android, iOS, Mac OS, Windows, Linux, Other).
    pub os_family: String,
    /// Device family label (iPhone, iPad, iPod, Other).
    pub device_family: String,
}

/// Parse a User-Agent string (best-effort parity with toggly-eval / Java / Python).
pub fn parse_user_agent(user_agent: Option<&str>) -> Option<ParsedUserAgent> {
    let ua = user_agent.filter(|s| !s.is_empty())?;
    Some(ParsedUserAgent {
        browser_family: detect_browser(ua).to_string(),
        os_family: detect_os(ua).to_string(),
        device_family: detect_device(ua).to_string(),
    })
}

fn detect_browser(ua: &str) -> &'static str {
    if ua.contains("Edg/") || ua.contains("EdgiOS/") {
        return "Edge";
    }
    if ua.contains("OPR/") || ua.contains("Opera") {
        return "Opera";
    }
    if ua.contains("Chrome/") || ua.contains("CriOS/") {
        return "Chrome";
    }
    if ua.contains("Firefox/") || ua.contains("FxiOS/") {
        return "Firefox";
    }
    if ua.contains("Safari/")
        && ua.contains("Version/")
        && !ua.contains("Chrome")
        && !ua.contains("Chromium")
    {
        return "Safari";
    }
    "Other"
}

fn detect_os(ua: &str) -> &'static str {
    if ua.contains("Android") {
        return "Android";
    }
    if ua.contains("iPhone")
        || ua.contains("iPad")
        || ua.contains("iPod")
        || ua.contains("CPU iPhone OS")
        || ua.contains("CPU OS")
    {
        return "iOS";
    }
    if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        return "Mac OS";
    }
    if ua.contains("Windows") {
        return "Windows";
    }
    if ua.contains("Linux") {
        return "Linux";
    }
    "Other"
}

fn detect_device(ua: &str) -> &'static str {
    if ua.contains("iPhone") {
        return "iPhone";
    }
    if ua.contains("iPad") {
        return "iPad";
    }
    if ua.contains("iPod") {
        return "iPod";
    }
    "Other"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chrome_desktop() {
        let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        let parsed = parse_user_agent(Some(ua)).unwrap();
        assert_eq!(parsed.browser_family, "Chrome");
        assert_eq!(parsed.os_family, "Mac OS");
        assert_eq!(parsed.device_family, "Other");
    }

    #[test]
    fn parses_iphone_safari() {
        let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        let parsed = parse_user_agent(Some(ua)).unwrap();
        assert_eq!(parsed.browser_family, "Safari");
        assert_eq!(parsed.os_family, "iOS");
        assert_eq!(parsed.device_family, "iPhone");
    }
}
