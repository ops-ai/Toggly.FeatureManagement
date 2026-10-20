package toggly

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/identity"
)

const (
	// SDKID identifies this SDK to Toggly definitions services.
	SDKID = identity.SDKID
	// SDKVersion is the semver of this SDK release.
	SDKVersion = identity.SDKVersion
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
