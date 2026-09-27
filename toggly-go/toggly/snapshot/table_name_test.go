package snapshot

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestSnapshotProvidersRejectUnsafeTableNames(t *testing.T) {
	for _, test := range []struct {
		name string
		load func(string) error
	}{
		{name: "postgres", load: func(table string) error {
			db, err := sql.Open("postgres", "postgres://127.0.0.1:1/unused?sslmode=disable")
			if err != nil {
				return err
			}
			defer func() { _ = db.Close() }()
			_, err = NewPostgresProvider(PostgresOptions{DB: db, TableName: table}).LoadDefinitions(context.Background())
			return err
		}},
		{name: "sqlite", load: func(table string) error {
			db, err := sql.Open("sqlite3", ":memory:")
			if err != nil {
				return err
			}
			defer func() { _ = db.Close() }()
			_, err = NewSQLiteProvider(SQLiteOptions{DB: db, TableName: table}).LoadDefinitions(context.Background())
			return err
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, table := range []string{`snapshots"; DROP TABLE users; --`, "snapshots.other", "123snapshots"} {
				err := test.load(table)
				if err == nil || !strings.Contains(err.Error(), "invalid snapshot table name") {
					t.Errorf("table %q: error = %v, want invalid table name", table, err)
				}
			}
		})
	}
}
