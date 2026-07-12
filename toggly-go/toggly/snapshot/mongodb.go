package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// MongoDBProvider stores snapshots in MongoDB.
//
// Documents:
// - {definitionsID} in collection
// - {jwksID} in collection
type MongoDBProvider struct {
	collection    *mongo.Collection
	definitionsID string
	jwksID        string
}

// MongoDBOptions configures the MongoDBProvider.
type MongoDBOptions struct {
	// Collection is the MongoDB collection. Required.
	Collection *mongo.Collection
	// DefinitionsID is the document ID for feature definitions. Default: "toggly_definitions".
	DefinitionsID string
	// JWKSID is the document ID for JWKS. Default: "toggly_jwks".
	JWKSID string
}

// mongoDocument represents a stored snapshot in MongoDB.
type mongoDocument struct {
	ID        string    `bson:"_id"`
	Data      string    `bson:"data"`
	Signature string    `bson:"signature,omitempty"`
	Kid       string    `bson:"kid,omitempty"`
	Timestamp int64     `bson:"timestamp,omitempty"`
	RawDefs   string    `bson:"rawDefs,omitempty"`
	ETag      string    `bson:"etag,omitempty"`
	Expiry    int64     `bson:"expiry,omitempty"`
	UpdatedAt time.Time `bson:"updatedAt"`
}

// NewMongoDBProvider creates a new MongoDB-based snapshot provider.
func NewMongoDBProvider(opts MongoDBOptions) *MongoDBProvider {
	definitionsID := opts.DefinitionsID
	if definitionsID == "" {
		definitionsID = "toggly_definitions"
	}
	jwksID := opts.JWKSID
	if jwksID == "" {
		jwksID = "toggly_jwks"
	}
	return &MongoDBProvider{
		collection:    opts.Collection,
		definitionsID: definitionsID,
		jwksID:        jwksID,
	}
}

func (m *MongoDBProvider) LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error) {
	var doc mongoDocument
	err := m.collection.FindOne(ctx, bson.M{"_id": m.definitionsID}).Decode(&doc)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, fmt.Errorf("mongodb find definitions: %w", err)
	}

	if doc.Data == "" {
		return nil, nil
	}

	var snap DefinitionsSnapshot
	if err := json.Unmarshal([]byte(doc.Data), &snap.Defs); err != nil {
		return nil, fmt.Errorf("decode definitions: %w", err)
	}
	snap.Signature = doc.Signature
	snap.Kid = doc.Kid
	snap.Timestamp = doc.Timestamp
	if doc.RawDefs != "" {
		snap.RawDefs = json.RawMessage(doc.RawDefs)
	}
	snap.ETag = doc.ETag
	return &snap, nil
}

func (m *MongoDBProvider) SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error {
	data, err := json.Marshal(snap.Defs)
	if err != nil {
		return fmt.Errorf("encode definitions: %w", err)
	}

	doc := mongoDocument{
		ID:        m.definitionsID,
		Data:      string(data),
		Signature: snap.Signature,
		Kid:       snap.Kid,
		Timestamp: snap.Timestamp,
		RawDefs:   string(snap.RawDefs),
		ETag:      snap.ETag,
		UpdatedAt: time.Now().UTC(),
	}

	opts := options.Replace().SetUpsert(true)
	_, err = m.collection.ReplaceOne(ctx, bson.M{"_id": m.definitionsID}, doc, opts)
	if err != nil {
		return fmt.Errorf("mongodb replace definitions: %w", err)
	}
	return nil
}

func (m *MongoDBProvider) Clear(ctx context.Context) error {
	_, err := m.collection.DeleteMany(ctx, bson.M{"_id": bson.M{"$in": []string{m.definitionsID, m.jwksID}}})
	if err != nil {
		return fmt.Errorf("mongodb clear snapshots: %w", err)
	}
	return nil
}

func (m *MongoDBProvider) LoadJWKS(ctx context.Context) (*JWKSnap, error) {
	var doc mongoDocument
	err := m.collection.FindOne(ctx, bson.M{"_id": m.jwksID}).Decode(&doc)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, fmt.Errorf("mongodb find jwks: %w", err)
	}

	if doc.Data == "" {
		return nil, nil
	}

	var snap JWKSnap
	if err := json.Unmarshal([]byte(doc.Data), &snap.Set); err != nil {
		return nil, fmt.Errorf("decode jwks: %w", err)
	}
	snap.Expiry = time.Unix(doc.Expiry, 0)
	return &snap, nil
}

func (m *MongoDBProvider) SaveJWKS(ctx context.Context, snap JWKSnap) error {
	data, err := json.Marshal(snap.Set)
	if err != nil {
		return fmt.Errorf("encode jwks: %w", err)
	}

	doc := mongoDocument{
		ID:        m.jwksID,
		Data:      string(data),
		Expiry:    snap.Expiry.Unix(),
		UpdatedAt: time.Now().UTC(),
	}

	opts := options.Replace().SetUpsert(true)
	_, err = m.collection.ReplaceOne(ctx, bson.M{"_id": m.jwksID}, doc, opts)
	if err != nil {
		return fmt.Errorf("mongodb replace jwks: %w", err)
	}
	return nil
}
