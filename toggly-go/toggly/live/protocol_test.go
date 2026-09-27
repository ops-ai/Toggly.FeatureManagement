package live

import "testing"

func TestUpdateMessagesOnlyRefreshForNewRevisions(t *testing.T) {
	for _, tc := range []struct {
		name, message, revision string
		force, update           bool
	}{
		{"legacy update", `update`, "r1", false, true},
		{"legacy flags", `flags-updated`, "r1", false, true},
		{"ping", `{"type":"ping"}`, "r1", false, false},
		{"unchanged sync", `{"type":"sync","unchanged":true}`, "r1", false, false},
		{"same sync", `{"type":"sync","etag":"r1"}`, "r1", false, false},
		{"new sync", `{"type":"sync","etag":"r2"}`, "r1", false, true},
		{"first sync", `{"type":"sync"}`, "", false, true},
		{"same flags", `{"type":"flags-updated","etag":"r1"}`, "r1", false, false},
		{"new flags", `{"type":"flags-updated","etag":"r2"}`, "r1", false, true},
		{"unknown revision", `{"type":"flags-updated"}`, "r1", false, true},
		{"signing key", `{"type":"signing-key-updated"}`, "r1", true, true},
		{"unknown type", `{"type":"other"}`, "r1", false, false},
		{"invalid JSON", `not-json`, "r1", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			force, update := shouldTriggerUpdate([]byte(tc.message), tc.revision)
			if force != tc.force || update != tc.update {
				t.Fatalf("message %s: force/update = %t/%t, want %t/%t", tc.message, force, update, tc.force, tc.update)
			}
		})
	}
}
