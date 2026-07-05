package toggly

import (
	"fmt"
	"net/http"
	"net/url"
)

const (
	// SDKID identifies this SDK to Toggly definitions services.
	SDKID = "go"
	// SDKVersion is the semver of this SDK release.
	SDKVersion = "0.1.1"
)

// SDKUserAgent returns the HTTP User-Agent value for server-side requests.
func SDKUserAgent() string {
	return fmt.Sprintf("toggly-%s/%s", SDKID, SDKVersion)
}

// SetSDKHeaders sets the User-Agent header on an outbound HTTP request.
func SetSDKHeaders(req *http.Request) {
	req.Header.Set("User-Agent", SDKUserAgent())
}

// AppendSDKQueryParams adds sdk and sdkVersion query parameters.
func AppendSDKQueryParams(q url.Values) {
	q.Set("sdk", SDKID)
	q.Set("sdkVersion", SDKVersion)
}
