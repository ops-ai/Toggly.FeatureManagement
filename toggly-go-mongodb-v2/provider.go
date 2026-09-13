// Package mongodbv2 provides a MongoDB Go Driver v2 snapshot.Provider for Toggly.
package mongodbv2

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// MongoDBProvider stores signed definition and JWKS snapshots in MongoDB.
//
// Its document layout is compatible with snapshot.MongoDBProvider from the
// retained MongoDB Go Driver v1 integration.
type MongoDBProvider struct {
	collection    *mongo.Collection
	definitionsID string
	jwksID        string
}

// MongoDBOptions configures a MongoDBProvider.
type MongoDBOptions struct {
	// Collection is the MongoDB collection where the two snapshot documents live.
	Collection *mongo.Collection
	// DefinitionsID is the definitions document ID. Default: "toggly_definitions".
	DefinitionsID string
	// JWKSID is the JWKS document ID. Default: "toggly_jwks".
	JWKSID string
}

// NewMongoDBProvider creates a MongoDB Driver v2 snapshot provider.
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

func definitionsDocument(id string, snap snapshot.DefinitionsSnapshot) (mongoDocument, error) {
	data, err := json.Marshal(snap.Defs)
	if err != nil {
		return mongoDocument{}, fmt.Errorf("encode definitions: %w", err)
	}

	return mongoDocument{
		ID:        id,
		Data:      string(data),
		Signature: snap.Signature,
		Kid:       snap.Kid,
		Timestamp: snap.Timestamp,
		RawDefs:   string(snap.RawDefs),
		ETag:      snap.ETag,
		UpdatedAt: time.Now().UTC(),
	}, nil
}

func definitionsSnapshot(doc mongoDocument) (*snapshot.DefinitionsSnapshot, error) {
	if doc.Data == "" {
		return nil, nil
	}

	var defs snapshot.DefinitionsSnapshot
	if err := json.Unmarshal([]byte(doc.Data), &defs.Defs); err != nil {
		return nil, fmt.Errorf("decode definitions: %w", err)
	}
	defs.Signature = doc.Signature
	defs.Kid = doc.Kid
	defs.Timestamp = doc.Timestamp
	if doc.RawDefs != "" {
		defs.RawDefs = json.RawMessage(doc.RawDefs)
	}
	defs.ETag = doc.ETag
	return &defs, nil
}

func jwksDocument(id string, snap snapshot.JWKSnap) (mongoDocument, error) {
	data, err := json.Marshal(snap.Set)
	if err != nil {
		return mongoDocument{}, fmt.Errorf("encode jwks: %w", err)
	}

	return mongoDocument{
		ID:        id,
		Data:      string(data),
		Expiry:    snap.Expiry.Unix(),
		UpdatedAt: time.Now().UTC(),
	}, nil
}

func jwksSnapshot(doc mongoDocument) (*snapshot.JWKSnap, error) {
	if doc.Data == "" {
		return nil, nil
	}

	var jwks snapshot.JWKSnap
	if err := json.Unmarshal([]byte(doc.Data), &jwks.Set); err != nil {
		return nil, fmt.Errorf("decode jwks: %w", err)
	}
	jwks.Expiry = time.Unix(doc.Expiry, 0)
	return &jwks, nil
}

// LoadDefinitions loads the last verified feature definitions snapshot.
func (m *MongoDBProvider) LoadDefinitions(ctx context.Context) (*snapshot.DefinitionsSnapshot, error) {
	var doc mongoDocument
	err := m.collection.FindOne(ctx, bson.M{"_id": m.definitionsID}).Decode(&doc)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, fmt.Errorf("mongodb find definitions: %w", err)
	}

	return definitionsSnapshot(doc)
}

// SaveDefinitions stores a verified feature definitions snapshot.
func (m *MongoDBProvider) SaveDefinitions(ctx context.Context, snap snapshot.DefinitionsSnapshot) error {
	doc, err := definitionsDocument(m.definitionsID, snap)
	if err != nil {
		return err
	}

	_, err = m.collection.ReplaceOne(
		ctx,
		bson.M{"_id": m.definitionsID},
		doc,
		options.Replace().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("mongodb replace definitions: %w", err)
	}
	return nil
}

// Clear removes both definitions and JWKS snapshots.
func (m *MongoDBProvider) Clear(ctx context.Context) error {
	_, err := m.collection.DeleteMany(ctx, bson.M{"_id": bson.M{"$in": []string{m.definitionsID, m.jwksID}}})
	if err != nil {
		return fmt.Errorf("mongodb clear snapshots: %w", err)
	}
	return nil
}

// LoadJWKS loads the last verified JWKS snapshot.
func (m *MongoDBProvider) LoadJWKS(ctx context.Context) (*snapshot.JWKSnap, error) {
	var doc mongoDocument
	err := m.collection.FindOne(ctx, bson.M{"_id": m.jwksID}).Decode(&doc)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, fmt.Errorf("mongodb find jwks: %w", err)
	}

	return jwksSnapshot(doc)
}

// SaveJWKS stores a verified JWKS snapshot.
func (m *MongoDBProvider) SaveJWKS(ctx context.Context, snap snapshot.JWKSnap) error {
	doc, err := jwksDocument(m.jwksID, snap)
	if err != nil {
		return err
	}

	_, err = m.collection.ReplaceOne(
		ctx,
		bson.M{"_id": m.jwksID},
		doc,
		options.Replace().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("mongodb replace jwks: %w", err)
	}
	return nil
}

var _ snapshot.Provider = (*MongoDBProvider)(nil)
