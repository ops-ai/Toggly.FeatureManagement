package io.toggly.core.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.VariantAllocation;
import io.toggly.core.model.VariantDefinition;
import io.toggly.core.model.VariantStatusOverride;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

/**
 * Replays {@code variant-allocator-corpus/cases.json} — ground-truth variant
 * assignment outcomes captured from {@code Microsoft.FeatureManagement} 4.7.0
 * — against {@link VariantAllocator}, asserting an exact match on assigned
 * variant name, configuration value, effective enabled state, and assignment
 * reason for every case.
 *
 * <p>See {@code variant-allocator-corpus/README.md} for the corpus schema
 * and how it is regenerated.</p>
 */
class VariantAllocatorCorpusTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void corpusFileExistsAndHasCases() throws IOException {
        Path file = resolveCorpusFile();
        assertNotNull(file, "variant-allocator-corpus/cases.json not found");
        JsonNode root = MAPPER.readTree(Files.readString(file));
        assertEquals(true, root.isArray() && root.size() > 0, "corpus must contain at least one case");
    }

    @TestFactory
    Stream<DynamicTest> goldCorpusCases() throws IOException {
        Path file = resolveCorpusFile();
        assertNotNull(file, "variant-allocator-corpus/cases.json not found");
        JsonNode root = MAPPER.readTree(Files.readString(file));

        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode caseNode : root) {
            String id = caseNode.path("id").asText();
            tests.add(dynamicTest(id, () -> {
                FeatureDefinition definition = toDefinition(caseNode.path("feature"));
                EvaluationContext context = toContext(caseNode.path("targeting"));
                boolean ignoreCase = caseNode.path("ignoreCase").asBoolean(false);

                EvaluationEngine engine = new EvaluationEngine();
                boolean enabled = engine.evaluate(definition, context);

                VariantAssignment assignment = VariantAllocator.assign(definition, enabled, context, ignoreCase);

                JsonNode expected = caseNode.path("expected");
                String expectedVariantName = textOrNull(expected, "variantName");
                Object expectedConfigurationValue = jsonValue(expected.get("configurationValue"));
                boolean expectedEnabled = expected.path("enabled").asBoolean();
                String expectedReason = expected.path("assignmentReason").asText();

                assertEquals(expectedVariantName, assignment.getVariantName(),
                        () -> "case " + id + ": variantName mismatch");
                Object actualConfigurationValue = assignment.getVariantDefinition() != null
                        ? assignment.getVariantDefinition().getConfigurationValue()
                        : null;
                assertEquals(expectedConfigurationValue, actualConfigurationValue,
                        () -> "case " + id + ": configurationValue mismatch");
                assertEquals(expectedEnabled, assignment.isEnabled(),
                        () -> "case " + id + ": enabled mismatch");
                assertEquals(expectedReason, assignment.getReason().getWireName(),
                        () -> "case " + id + ": assignmentReason mismatch");
            }));
        }
        return tests.stream();
    }

    private static FeatureDefinition toDefinition(JsonNode featureNode) {
        String featureKey = featureNode.path("name").asText();

        List<FeatureFilter> filters = new ArrayList<>();
        for (JsonNode filterNode : featureNode.path("enabledFor")) {
            filters.add(FeatureFilter.of(filterNode.path("name").asText(), Map.of()));
        }

        List<VariantDefinition> variants = new ArrayList<>();
        for (JsonNode variantNode : featureNode.path("variants")) {
            String name = variantNode.path("name").asText();
            Object configurationValue = jsonValue(variantNode.get("configurationValue"));
            VariantStatusOverride statusOverride =
                    VariantStatusOverride.fromString(textOrNull(variantNode, "statusOverride"));
            variants.add(new VariantDefinition(name, configurationValue, statusOverride));
        }

        VariantAllocation allocation = toAllocation(featureNode.get("allocation"));

        return FeatureDefinition.builder()
                .featureKey(featureKey)
                .filters(filters)
                .variants(variants)
                .allocation(allocation)
                .build();
    }

    private static VariantAllocation toAllocation(JsonNode allocationNode) {
        if (allocationNode == null || allocationNode.isNull()) {
            return null;
        }
        VariantAllocation.Builder builder = VariantAllocation.builder()
                .defaultWhenEnabled(textOrNull(allocationNode, "defaultWhenEnabled"))
                .defaultWhenDisabled(textOrNull(allocationNode, "defaultWhenDisabled"))
                .seed(textOrNull(allocationNode, "seed"));

        List<VariantAllocation.UserAllocation> userAllocations = new ArrayList<>();
        for (JsonNode userNode : allocationNode.path("user")) {
            userAllocations.add(new VariantAllocation.UserAllocation(
                    userNode.path("variant").asText(), toStringList(userNode.path("users"))));
        }
        builder.userAllocations(userAllocations);

        List<VariantAllocation.GroupAllocation> groupAllocations = new ArrayList<>();
        for (JsonNode groupNode : allocationNode.path("group")) {
            groupAllocations.add(new VariantAllocation.GroupAllocation(
                    groupNode.path("variant").asText(), toStringList(groupNode.path("groups"))));
        }
        builder.groupAllocations(groupAllocations);

        List<VariantAllocation.PercentileAllocation> percentileAllocations = new ArrayList<>();
        for (JsonNode percentileNode : allocationNode.path("percentile")) {
            percentileAllocations.add(new VariantAllocation.PercentileAllocation(
                    percentileNode.path("variant").asText(),
                    percentileNode.path("from").asDouble(),
                    percentileNode.path("to").asDouble()));
        }
        builder.percentileAllocations(percentileAllocations);

        return builder.build();
    }

    private static EvaluationContext toContext(JsonNode targetingNode) {
        EvaluationContext.Builder builder = EvaluationContext.builder();
        String userId = textOrNull(targetingNode, "userId");
        if (userId != null) {
            builder.identity(userId);
        }
        List<String> groups = toStringList(targetingNode.path("groups"));
        if (!groups.isEmpty()) {
            builder.groups(groups);
        }
        return builder.build();
    }

    private static List<String> toStringList(JsonNode arrayNode) {
        List<String> result = new ArrayList<>();
        if (arrayNode == null || !arrayNode.isArray()) {
            return result;
        }
        for (JsonNode item : arrayNode) {
            result.add(item.asText());
        }
        return result;
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.asText();
    }

    /**
     * Converts an arbitrary JSON value to a plain Java value tree
     * ({@link String}, {@link Long}, {@link Double}, {@link Boolean},
     * {@link Map}, {@link List}, or {@code null}) matching what
     * {@code VariantDefinition#getConfigurationValue()} holds after wire
     * parsing, so corpus expectations compare directly via {@code equals}.
     */
    private static Object jsonValue(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        if (node.isObject()) {
            Map<String, Object> map = new LinkedHashMap<>();
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> entry = fields.next();
                map.put(entry.getKey(), jsonValue(entry.getValue()));
            }
            return map;
        }
        if (node.isArray()) {
            List<Object> list = new ArrayList<>();
            for (JsonNode item : node) {
                list.add(jsonValue(item));
            }
            return list;
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isIntegralNumber()) {
            return node.longValue();
        }
        if (node.isFloatingPointNumber()) {
            return node.doubleValue();
        }
        return node.asText();
    }

    /**
     * Resolves {@code variant-allocator-corpus/cases.json} from the repo root
     * regardless of whether surefire runs from the Java parent or the
     * toggly-core module.
     */
    static Path resolveCorpusFile() {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        Path[] candidates = new Path[] {
                cwd.resolve("variant-allocator-corpus/cases.json"),
                cwd.resolve("../variant-allocator-corpus/cases.json"),
                cwd.resolve("../../variant-allocator-corpus/cases.json"),
                cwd.resolve("../../../variant-allocator-corpus/cases.json")
        };
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate.normalize();
            }
        }
        Path walk = cwd;
        for (int i = 0; i < 6; i++) {
            Path candidate = walk.resolve("variant-allocator-corpus/cases.json");
            if (Files.isRegularFile(candidate)) {
                return candidate.normalize();
            }
            walk = walk.getParent();
            if (walk == null) {
                break;
            }
        }
        return null;
    }
}
