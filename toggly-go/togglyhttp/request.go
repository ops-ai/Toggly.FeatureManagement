package togglyhttp

import (
	"net/http"
	"strings"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
)

// FromHttpRequest maps common HTTP request headers into EvalContext.request fields
// (User-Agent, Accept-Language, country). Does not set identity/groups/claims —
// merge those separately via extras or Middleware Options.
//
// Country is taken from the first present header among:
// cf-ipcountry, x-vercel-ip-country, cloudfront-viewer-country.
func FromHttpRequest(r *http.Request, extras ...toggly.Context) toggly.Context {
	var out toggly.Context
	if len(extras) > 0 {
		out = extras[0]
	}
	if r == nil {
		return out
	}
	out.Request = requestFromHeaders(r.Header)
	return out
}

func requestFromHeaders(h http.Header) *toggly.RequestContext {
	if h == nil {
		return &toggly.RequestContext{}
	}
	return &toggly.RequestContext{
		UserAgent:      firstHeader(h, "User-Agent"),
		AcceptLanguage: firstHeader(h, "Accept-Language"),
		Country: firstNonEmpty(
			firstHeader(h, "CF-IPCountry"),
			firstHeader(h, "X-Vercel-IP-Country"),
			firstHeader(h, "CloudFront-Viewer-Country"),
		),
	}
}

func firstHeader(h http.Header, name string) string {
	v := h.Get(name)
	return strings.TrimSpace(v)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// mergeRequestFromHeaders fills missing request fields from headers.
// When existing is nil, returns a full header-derived RequestContext.
// When existing is set, non-empty existing fields win; empty fields take headers.
func mergeRequestFromHeaders(h http.Header, existing *toggly.RequestContext) *toggly.RequestContext {
	fromHeaders := requestFromHeaders(h)
	if existing == nil {
		return fromHeaders
	}
	out := *fromHeaders
	if existing.UserAgent != "" {
		out.UserAgent = existing.UserAgent
	}
	if existing.AcceptLanguage != "" {
		out.AcceptLanguage = existing.AcceptLanguage
	}
	if existing.Country != "" {
		out.Country = existing.Country
	}
	return &out
}
