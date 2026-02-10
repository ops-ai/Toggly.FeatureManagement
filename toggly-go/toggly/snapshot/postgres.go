package snapshot

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// PostgresProvider stores snapshots in PostgreSQL.
//
// Table: toggly_snapshots (or custom)
type PostgresProvider struct {
	db            *sql.DB
	tableName     string
	definitionsID string
	jwksID        string
	autoCreate    bool
	tableCreated  bool
}

// PostgresOptions configures the PostgresProvider.
type PostgresOptions struct {
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

// NewPostgresProvider creates a new PostgreSQL-based snapshot provider.
func NewPostgresProvider(opts PostgresOptions) *PostgresProvider {
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
	// Default to true if not explicitly set (Go zero value is false)
	if opts.DB != nil && !opts.AutoCreateTable {
		autoCreate = true
	}
	return &PostgresProvider{
		db:            opts.DB,
		tableName:     tableName,
		definitionsID: definitionsID,
		jwksID:        jwksID,
		autoCreate:    autoCreate,
	}
}

func (p *PostgresProvider) ensureTable(ctx context.Context) error {
	if p.tableCreated || !p.autoCreate {
		return nil
	}

	query := fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS "%s" (
			id VARCHAR(100) NOT NULL PRIMARY KEY,
			data TEXT NOT NULL,
			signature VARCHAR(1000),
			kid VARCHAR(100),
			timestamp BIGINT,
			expiry BIGINT,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`, p.tableName)

	_, err := p.db.ExecContext(ctx, query)
	if err != nil {
		return fmt.Errorf("create table: %w", err)
	}
	p.tableCreated = true
	return nil
}

func (p *PostgresProvider) LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error) {
	if err := p.ensureTable(ctx); err != nil {
		return nil, err
	}

	query := fmt.Sprintf(`SELECT data, signature, kid, timestamp FROM "%s" WHERE id = $1`, p.tableName)
	row := p.db.QueryRowContext(ctx, query, p.definitionsID)

	var data string
	var signature, kid sql.NullString
	var timestamp sql.NullInt64

	err := row.Scan(&data, &signature, &kid, &timestamp)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("postgres query definitions: %w", err)
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
	return &snap, nil
}

func (p *PostgresProvider) SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error {
	if err := p.ensureTable(ctx); err != nil {
		return err
	}

	data, err := json.Marshal(snap.Defs)
	if err != nil {
		return fmt.Errorf("encode definitions: %w", err)
	}

	query := fmt.Sprintf(`
		INSERT INTO "%s" (id, data, signature, kid, timestamp, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			data = EXCLUDED.data,
			signature = EXCLUDED.signature,
			kid = EXCLUDED.kid,
			timestamp = EXCLUDED.timestamp,
			updated_at = EXCLUDED.updated_at
	`, p.tableName)

	_, err = p.db.ExecContext(ctx, query,
		p.definitionsID,
		string(data),
		nullString(snap.Signature),
		nullString(snap.Kid),
		nullInt64(snap.Timestamp),
		time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("postgres upsert definitions: %w", err)
	}
	return nil
}

func (p *PostgresProvider) LoadJWKS(ctx context.Context) (*JWKSnap, error) {
	if err := p.ensureTable(ctx); err != nil {
		return nil, err
	}

	query := fmt.Sprintf(`SELECT data, expiry FROM "%s" WHERE id = $1`, p.tableName)
	row := p.db.QueryRowContext(ctx, query, p.jwksID)

	var data string
	var expiry sql.NullInt64

	err := row.Scan(&data, &expiry)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("postgres query jwks: %w", err)
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

func (p *PostgresProvider) SaveJWKS(ctx context.Context, snap JWKSnap) error {
	if err := p.ensureTable(ctx); err != nil {
		return err
	}

	data, err := json.Marshal(snap.Set)
	if err != nil {
		return fmt.Errorf("encode jwks: %w", err)
	}

	query := fmt.Sprintf(`
		INSERT INTO "%s" (id, data, expiry, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE SET
			data = EXCLUDED.data,
			expiry = EXCLUDED.expiry,
			updated_at = EXCLUDED.updated_at
	`, p.tableName)

	_, err = p.db.ExecContext(ctx, query,
		p.jwksID,
		string(data),
		snap.Expiry.Unix(),
		time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("postgres upsert jwks: %w", err)
	}
	return nil
}

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

func nullInt64(i int64) sql.NullInt64 {
	if i == 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: i, Valid: true}
}
