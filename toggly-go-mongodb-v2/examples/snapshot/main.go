// Package main demonstrates configuring Toggly snapshots with MongoDB Go Driver v2.
package main

import (
	"context"
	"log"

	mongodbv2 "github.com/ops-ai/Toggly.FeatureManagement/toggly-go-mongodb-v2"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func main() {
	ctx := context.Background()
	mongoClient, err := mongo.Connect(options.Client().ApplyURI("mongodb://localhost:27017"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = mongoClient.Disconnect(ctx) }()

	provider := mongodbv2.NewMongoDBProvider(mongodbv2.MongoDBOptions{
		Collection: mongoClient.Database("toggly").Collection("snapshots"),
	})

	client, err := toggly.NewClient(toggly.Config{
		AppKey:           "YOUR_APP_KEY",
		Environment:      "Production",
		SnapshotProvider: provider,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = client.Close() }()
}
