package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.context.RequestContext;
import io.toggly.core.model.FeatureFilter;

import java.util.List;

/**
 * Evaluator for BrowserLanguage segment filters.
 */
public final class BrowserLanguageEvaluator implements FilterEvaluator {

    public static final BrowserLanguageEvaluator INSTANCE = new BrowserLanguageEvaluator();

    private BrowserLanguageEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        Double percentage = FilterParamUtils.asFloat(filter, "Percentage");
        String identity = context != null ? context.getIdentity() : null;
        if (!SegmentPercentageGate.passes(percentage, featureKey, identity)) {
            return false;
        }
        List<String> values = FilterParamUtils.collectIndexedValues(
                filter.getParameters(), "BrowserLanguage");
        if (values.isEmpty()) {
            return false;
        }
        RequestContext request = context != null ? context.getRequest() : null;
        String acceptLanguage = request != null ? request.getAcceptLanguage() : null;
        if (acceptLanguage == null || acceptLanguage.isEmpty()) {
            return false;
        }
        for (String value : values) {
            if (FilterParamUtils.containsIgnoreCase(acceptLanguage, value)) {
                return true;
            }
        }
        return false;
    }
}
