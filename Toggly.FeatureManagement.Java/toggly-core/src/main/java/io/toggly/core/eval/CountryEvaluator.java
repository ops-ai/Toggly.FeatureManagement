package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.context.RequestContext;
import io.toggly.core.model.FeatureFilter;

import java.util.List;

/**
 * Evaluator for Country / CountryFamily segment filters.
 */
public final class CountryEvaluator implements FilterEvaluator {

    public static final CountryEvaluator INSTANCE = new CountryEvaluator();

    private CountryEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        Double percentage = FilterParamUtils.asFloat(filter, "Percentage");
        String identity = context != null ? context.getIdentity() : null;
        if (!SegmentPercentageGate.passes(percentage, featureKey, identity)) {
            return false;
        }
        List<String> values = FilterParamUtils.collectIndexedValues(
                filter.getParameters(), "Country");
        if (values.isEmpty()) {
            return false;
        }
        RequestContext request = context != null ? context.getRequest() : null;
        String country = request != null ? request.getCountry() : null;
        if (country == null || country.isEmpty()) {
            return false;
        }
        for (String value : values) {
            if (FilterParamUtils.equalsIgnoreCase(value, country)) {
                return true;
            }
        }
        return false;
    }
}
