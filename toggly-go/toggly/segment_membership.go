package toggly

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// SegmentMembershipClient updates targeting-list members with a Backend app key.
type SegmentMembershipClient struct {
	AppKey  string
	BaseURL string
	HTTP    *http.Client
}

func (c *SegmentMembershipClient) base() string {
	base := c.BaseURL
	if base == "" {
		base = "https://app.toggly.io"
	}
	return strings.TrimRight(base, "/")
}

func (c *SegmentMembershipClient) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *SegmentMembershipClient) ListSegments() ([]map[string]any, error) {
	var out []map[string]any
	err := c.send(http.MethodGet, "/api/v2/segments", nil, &out)
	return out, err
}

func (c *SegmentMembershipClient) AddSegmentMembers(segment string, identifiers []string) (map[string]any, error) {
	var out map[string]any
	err := c.send(http.MethodPost, "/api/v2/segments/"+url.PathEscape(segment)+"/items", map[string]any{"identifiers": identifiers}, &out)
	return out, err
}

func (c *SegmentMembershipClient) RemoveSegmentMembers(segment string, identifiers []string) (map[string]any, error) {
	var out map[string]any
	err := c.send(http.MethodDelete, "/api/v2/segments/"+url.PathEscape(segment)+"/items", map[string]any{"identifiers": identifiers}, &out)
	return out, err
}

func (c *SegmentMembershipClient) ReplaceSegmentMembers(segment string, identifiers []string) (map[string]any, error) {
	var out map[string]any
	err := c.send(http.MethodPut, "/api/v2/segments/"+url.PathEscape(segment)+"/items", map[string]any{"identifiers": identifiers}, &out)
	return out, err
}

func (c *SegmentMembershipClient) send(method, path string, body any, dest any) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequest(method, c.base()+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", c.AppKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("segment membership %s %s failed: %d", method, path, resp.StatusCode)
	}
	if dest == nil || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, dest)
}
