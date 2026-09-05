package io.toggly.core.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.context.HttpRequestMapper;
import io.toggly.core.context.RequestContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

/**
 * Loads golden fixtures from {@code docs/filter-parity/fixtures/} and asserts
 * Java eval matches the shared contract.
 */
class FilterParityFixturesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Set<String> REQUIRED_IDS = Set.of(
            "browser-family-match",
            "browser-family-miss",
            "browser-language-match",
            "country-from-request",
            "country-from-cf-ipcountry",
            "device-type-match",
            "os-match",
            "user-claims-match",
            "user-claims-miss",
            "targeting-groups-match",
            "percentage-missing-fail-closed",
            "percentage-zero-fail-closed",
            "unknown-filter-fail-closed");

    @Test
    void loadsRequiredWave1Cases() throws IOException {
        Path dir = resolveFixturesDir();
        assertNotNull(dir, "docs/filter-parity/fixtures not found");
        Set<String> ids = new java.util.HashSet<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.json")) {
            for (Path file : stream) {
                JsonNode root = MAPPER.readTree(Files.readString(file));
                ids.add(root.path("id").asText());
            }
        }
        for (String required : REQUIRED_IDS) {
            assertTrue(ids.contains(required), "missing fixture " + required);
        }
    }

    @TestFactory
    Stream<DynamicTest> goldenFixtures() throws IOException {
        Path dir = resolveFixturesDir();
        assertNotNull(dir, "docs/filter-parity/fixtures not found");
        EvaluationEngine engine = new EvaluationEngine();
        List<DynamicTest> tests = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.json")) {
            List<Path> files = new ArrayList<>();
            stream.forEach(files::add);
            files.sort(Path::compareTo);
            for (Path file : files) {
                JsonNode root = MAPPER.readTree(Files.readString(file));
                String id = root.path("id").asText();
                String description = root.path("description").asText();
                tests.add(dynamicTest(id + ": " + description, () -> {
                    FeatureDefinition definition = toDefinition(root);
                    EvaluationContext context = toContext(root);
                    boolean expected = root.path("expected").asBoolean();
                    assertEquals(expected, engine.evaluate(definition, context),
                            () -> "fixture " + id + " failed");
                }));
            }
        }
        return tests.stream();
    }

    private static FeatureDefinition toDefinition(JsonNode root) {
        String featureKey = root.path("featureKey").asText();
        FeatureRequirement requirement = FeatureRequirement.fromString(
                root.path("requirementType").asText(null));
        List<FeatureFilter> filters = new ArrayList<>();
        for (JsonNode filterNode : root.path("filters")) {
            String name = filterNode.path("name").asText();
            Map<String, Object> params = new HashMap<>();
            JsonNode parameters = filterNode.path("parameters");
            if (parameters.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> fields = parameters.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> entry = fields.next();
                    params.put(entry.getKey(), jsonValue(entry.getValue()));
                }
            }
            filters.add(FeatureFilter.of(name, params));
        }
        return FeatureDefinition.builder()
                .featureKey(featureKey)
                .requirementType(requirement)
                .filters(filters)
                .build();
    }

    private static EvaluationContext toContext(JsonNode root) {
        EvaluationContext.Builder builder = EvaluationContext.builder();
        JsonNode context = root.path("context");
        if (context.isObject()) {
            if (context.hasNonNull("identity")) {
                builder.identity(context.get("identity").asText());
            }
            if (context.has("groups") && context.get("groups").isArray()) {
                List<String> groups = new ArrayList<>();
                for (JsonNode g : context.get("groups")) {
                    groups.add(g.asText());
                }
                builder.groups(groups);
            }
            if (context.has("claims") && context.get("claims").isObject()) {
                Map<String, String> claims = new HashMap<>();
                Iterator<Map.Entry<String, JsonNode>> fields = context.get("claims").fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> entry = fields.next();
                    claims.put(entry.getKey(), entry.getValue().asText());
                }
                builder.claims(claims);
            }
            if (context.has("request") && context.get("request").isObject()) {
                JsonNode request = context.get("request");
                builder.request(RequestContext.builder()
                        .userAgent(textOrNull(request, "userAgent"))
                        .acceptLanguage(textOrNull(request, "acceptLanguage"))
                        .country(textOrNull(request, "country"))
                        .build());
            }
        }

        EvaluationContext base = builder.build();
        JsonNode headers = root.path("httpHeaders");
        if (headers.isObject() && headers.size() > 0) {
            Map<String, String> headerMap = new HashMap<>();
            Iterator<Map.Entry<String, JsonNode>> fields = headers.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> entry = fields.next();
                headerMap.put(entry.getKey(), entry.getValue().asText());
            }
            return HttpRequestMapper.mergeInto(headerMap, base);
        }
        return base;
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.asText();
    }

    private static Object jsonValue(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isNumber()) {
            return node.numberValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        return node.asText();
    }

    /**
     * Resolves fixtures from the FeatureManagement repo root regardless of whether
     * surefire runs from the Java parent or the toggly-core module.
     */
    static Path resolveFixturesDir() {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        Path[] candidates = new Path[] {
                cwd.resolve("docs/filter-parity/fixtures"),
                cwd.resolve("../docs/filter-parity/fixtures"),
                cwd.resolve("../../docs/filter-parity/fixtures"),
                cwd.resolve("../../../docs/filter-parity/fixtures")
        };
        for (Path candidate : candidates) {
            if (Files.isDirectory(candidate)) {
                return candidate.normalize();
            }
        }
        Path walk = cwd;
        for (int i = 0; i < 6; i++) {
            Path candidate = walk.resolve("docs/filter-parity/fixtures");
            if (Files.isDirectory(candidate)) {
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
