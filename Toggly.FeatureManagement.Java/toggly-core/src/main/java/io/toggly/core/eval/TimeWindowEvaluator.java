package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;

/**
 * Evaluator for time-based feature availability.
 */
public final class TimeWindowEvaluator implements FilterEvaluator {

    public static final TimeWindowEvaluator INSTANCE = new TimeWindowEvaluator();

    private TimeWindowEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        Instant now = Instant.now();

        // Check start time
        String startStr = filter.getStringParameter("Start");
        if (startStr == null) startStr = filter.getStringParameter("start");

        if (startStr != null && !startStr.isEmpty()) {
            Instant start = parseDateTime(startStr);
            if (start != null && now.isBefore(start)) {
                return false;
            }
        }

        // Check end time
        String endStr = filter.getStringParameter("End");
        if (endStr == null) endStr = filter.getStringParameter("end");

        if (endStr != null && !endStr.isEmpty()) {
            Instant end = parseDateTime(endStr);
            if (end != null && now.isAfter(end)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Parses an ISO-8601 datetime string to an Instant.
     *
     * @param dateTimeStr the datetime string
     * @return the Instant or null if parsing fails
     */
    private Instant parseDateTime(String dateTimeStr) {
        try {
            // Handle 'Z' suffix
            String normalized = dateTimeStr.replace("Z", "+00:00");
            return OffsetDateTime.parse(normalized).toInstant();
        } catch (DateTimeParseException e) {
            // Try parsing as instant directly
            try {
                return Instant.parse(dateTimeStr);
            } catch (DateTimeParseException e2) {
                return null;
            }
        }
    }
}
