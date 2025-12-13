package secure

import "context"

// AuthorizationService performs an additional authorization check for secured features.
//
// The evalCtx argument is whatever the application passed to the SDK when evaluating the feature.
// Implementations can type-assert it to the expected shape.
type AuthorizationService interface {
	IsAllowed(ctx context.Context, featureKey string, evalCtx any) (bool, error)
}
