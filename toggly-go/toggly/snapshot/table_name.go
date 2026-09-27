package snapshot

import "fmt"

// validateSnapshotTableName restricts interpolated SQL identifiers to one
// unqualified ASCII identifier. PostgreSQL truncates names longer than 63 bytes.
func validateSnapshotTableName(name string) error {
	if len(name) == 0 || len(name) > 63 {
		return fmt.Errorf("invalid snapshot table name %q", name)
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c == '_' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || i > 0 && c >= '0' && c <= '9' {
			continue
		}
		return fmt.Errorf("invalid snapshot table name %q", name)
	}
	return nil
}
