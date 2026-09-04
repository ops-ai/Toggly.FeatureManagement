package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

import java.util.Map;

/**
 * Evaluator for UserClaims filters ({@code Claim} + {@code Value} params).
 */
public final class UserClaimsEvaluator implements FilterEvaluator {

    public static final UserClaimsEvaluator INSTANCE = new UserClaimsEvaluator();

    private UserClaimsEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        Double percentage = FilterParamUtils.asFloat(filter, "Percentage");
        String identity = context != null ? context.getIdentity() : null;
        if (!SegmentPercentageGate.passes(percentage, featureKey, identity)) {
            return false;
        }
        String claimType = FilterParamUtils.asString(filter, "Claim");
        String claimValue = FilterParamUtils.asString(filter, "Value");
        if (claimType == null || claimValue == null) {
            return false;
        }
        if (context == null) {
            return false;
        }
        Map<String, String> claims = context.getClaims();
        if (claims == null || !claims.containsKey(claimType)) {
            return false;
        }
        return claimValue.equals(claims.get(claimType));
    }
}
