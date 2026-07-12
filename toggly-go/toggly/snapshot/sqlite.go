package snapshot

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// SQLiteProvider stores snapshots in SQLite.
//
// Table: toggly_snapshots (or custom)
type SQLiteProvider struct {
	db            *sql.DB
	tableName     string
	definitionsID string
	jwksID        string
	autoCreate    bool
	tableCreated  bool
}

// SQLiteOptions configures the SQLiteProvider.
type SQLiteOptions struct {
	// DB is the database connection. Required.
	DB *sql.DB
	// TableName for storing snapshots. Default: "toggly_snapshots".
	TableName string
	// DefinitionsID is the row ID for feature definitions. Default: "toggly_definitions".
	DefinitionsID string
	// JWKSID is the row ID for JWKS. Default: "toggly_jwks".
	JWKSID string
	// AutoCreateTable creates the table if it doesn't exist. Default: true.
	AutoCreateTable bool
}

// NewSQLiteProvider creates a new SQLite-based snapshot provider.
func NewSQLiteProvider(opts SQLiteOptions) *SQLiteProvider {
	tableName := opts.TableName
	if tableName == "" {
		tableName = "toggly_snapshots"
	}
	definitionsID := opts.DefinitionsID
	if definitionsID == "" {
		definitionsID = "toggly_definitions"
	}
	jwksID := opts.JWKSID
	if jwksID == "" {
		jwksID = "toggly_jwks"
	}
	autoCreate := opts.AutoCreateTable
	if opts.DB != nil && !opts.AutoCreateTable {
		autoCreate = true
	}
	return &SQLiteProvider{
		db:            opts.DB,
		tableName:     tableName,
		definitionsID: definitionsID,
		jwksID:        jwksID,
		autoCreate:    autoCreate,
	}
}

func (s *SQLiteProvider) ensureTable(ctx context.Context) error {
	if s.tableCreated || !s.autoCreate {
		return nil
	}

	query := fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS "%s" (
			id TEXT NOT NULL PRIMARY KEY,
			data TEXT NOT NULL,
			signature TEXT,
			kid TEXT,
			timestamp INTEGER,
			expiry INTEGER,
			raw_defs TEXT,
			etag TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`, s.tableName)

	_, err := s.db.ExecContext(ctx, query)
	if err != nil {
		return fmt.Errorf("create table: %w", err)
	}

	// Best-effort migration for tables created before raw_defs/etag existed.
	_, _ = s.db.ExecContext(ctx, fmt.Sprintf(`ALTER TABLE "%s" ADD COLUMN raw_defs TEXT`, s.tableName))
	_, _ = s.db.ExecContext(ctx, fmt.Sprintf(`ALTER TABLE "%s" ADD COLUMN etag TEXT`, s.tableName))

	s.tableCreated = true
	return nil
}

func (s *SQLiteProvider) LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error) {
	if err := s.ensureTable(ctx); err != nil {
		return nil, err
	}

	query := fmt.Sprintf(`SELECT data, signature, kid, timestamp, raw_defs, etag FROM "%s" WHERE id = ?`, s.tableName)
	row := s.db.QueryRowContext(ctx, query, s.definitionsID)

	var data string
	var signature, kid, rawDefs, etag sql.NullString
	var timestamp sql.NullInt64

	err := row.Scan(&data, &signature, &kid, &timestamp, &rawDefs, &etag)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("sqlite query definitions: %w", err)
	}

	if data == "" {
		return nil, nil
	}

	var snap DefinitionsSnapshot
	if err := json.Unmarshal([]byte(data), &snap.Defs); err != nil {
		return nil, fmt.Errorf("decode definitions: %w", err)
	}
	if signature.Valid {
		snap.Signature = signature.String
	}
	if kid.Valid {
		snap.Kid = kid.String
	}
	if timestamp.Valid {
		snap.Timestamp = timestamp.Int64
	}
	if rawDefs.Valid && rawDefs.String != "" {
		snap.RawDefs = json.RawMessage(rawDefs.String)
	}
	if etag.Valid {
		snap.ETag = etag.String
	}
	return &snap, nil
}

func (s *SQLiteProvider) SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error {
	if err := s.ensureTable(ctx); err != nil {
		return err
	}

	data, err := json.Marshal(snap.Defs)
	if err != nil {
		return fmt.Errorf("encode definitions: %w", err)
	}

	query := fmt.Sprintf(`
		INSERT OR REPLACE INTO "%s" (id, data, signature, kid, timestamp, raw_defs, etag, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, s.tableName)

	var sigPtr, kidPtr, rawPtr, etagPtr *string
	var tsPtr *int64
	if snap.Signature != "" {
		sigPtr = &snap.Signature
	}
	if snap.Kid != "" {
		kidPtr = &snap.Kid
	}
	if snap.Timestamp != 0 {
		tsPtr = &snap.Timestamp
	}
	if len(snap.RawDefs) > 0 {
		s := string(snap.RawDefs)
		rawPtr = &s
	}
	if snap.ETag != "" {
		etagPtr = &snap.ETag
	}

	_, err = s.db.ExecContext(ctx, query,
		s.definitionsID,
		string(data),
		sigPtr,
		kidPtr,
		tsPtr,
		rawPtr,
		etagPtr,
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("sqlite upsert definitions: %w", err)
	}
	return nil
}

func (s *SQLiteProvider) Clear(ctx context.Context) error {
	if err := s.ensureTable(ctx); err != nil {
		return err
	}
	query := fmt.Sprintf(`DELETE FROM "%s" WHERE id IN (?, ?)`, s.tableName)
	_, err := s.db.ExecContext(ctx, query, s.definitionsID, s.jwksID)
	if err != nil {
		return fmt.Errorf("sqlite clear snapshots: %w", err)
	}
	return nil
}

func (s *SQLiteProvider) LoadJWKS(ctx context.Context) (*JWKSnap, error) {
	if err := s.ensureTable(ctx); err != nil {
		return nil, err
	}

	query := fmt.Sprintf(`SELECT data, expiry FROM "%s" WHERE id = ?`, s.tableName)
	row := s.db.QueryRowContext(ctx, query, s.jwksID)

	var data string
	var expiry sql.NullInt64

	err := row.Scan(&data, &expiry)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("sqlite query jwks: %w", err)
	}

	if data == "" {
		return nil, nil
	}

	var snap JWKSnap
	if err := json.Unmarshal([]byte(data), &snap.Set); err != nil {
		return nil, fmt.Errorf("decode jwks: %w", err)
	}
	if expiry.Valid {
		snap.Expiry = time.Unix(expiry.Int64, 0)
	}
	return &snap, nil
}

func (s *SQLiteProvider) SaveJWKS(ctx context.Context, snap JWKSnap) error {
	if err := s.ensureTable(ctx); err != nil {
		return err
	}

	data, err := json.Marshal(snap.Set)
	if err != nil {
		return fmt.Errorf("encode jwks: %w", err)
	}

	query := fmt.Sprintf(`
		INSERT OR REPLACE INTO "%s" (id, data, expiry, updated_at)
		VALUES (?, ?, ?, ?)
	`, s.tableName)

	_, err = s.db.ExecContext(ctx, query,
		s.jwksID,
		string(data),
		snap.Expiry.Unix(),
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("sqlite upsert jwks: %w", err)
	}
	return nil
}
