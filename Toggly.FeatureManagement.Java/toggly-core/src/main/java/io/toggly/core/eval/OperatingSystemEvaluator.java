package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.context.RequestContext;
import io.toggly.core.model.FeatureFilter;

import java.util.List;

/**
 * Evaluator for OS / OperatingSystem segment filters.
 */
public final class OperatingSystemEvaluator implements FilterEvaluator {

    public static final OperatingSystemEvaluator INSTANCE = new OperatingSystemEvaluator();

    private OperatingSystemEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        Double percentage = FilterParamUtils.asFloat(filter, "Percentage");
        String identity = context != null ? context.getIdentity() : null;
        if (!SegmentPercentageGate.passes(percentage, featureKey, identity)) {
            return false;
        }
        List<String> values = FilterParamUtils.collectIndexedValues(
                filter.getParameters(), "OperatingSystem");
        if (values.isEmpty()) {
            return false;
        }
        RequestContext request = context != null ? context.getRequest() : null;
        String ua = request != null ? request.getUserAgent() : null;
        UserAgentParser.ParsedUserAgent parsed = UserAgentParser.parse(ua);
        if (parsed == null) {
            return false;
        }
        String family = parsed.getOsFamily();
        if (family == null || "Other".equals(family)) {
            return false;
        }
        for (String value : values) {
            if (FilterParamUtils.containsIgnoreCase(family, value)) {
                return true;
            }
        }
        return false;
    }
}
