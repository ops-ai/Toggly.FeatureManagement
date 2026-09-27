package io.toggly.core.util;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SimpleJsonTest {

    @Test
    void extractValue_readsTopLevelKeyOnly_ignoringNestedHomonyms() {
        String json = "{"
                + "\"filters\":[{\"parameters\":{\"variants\":\"nested-string\",\"allocation\":\"nested-string\"}}],"
                + "\"variants\":[{\"name\":\"A\",\"configurationValue\":{\"color\":\"blue\"}}],"
                + "\"allocation\":{\"defaultWhenEnabled\":\"A\"}"
                + "}";

        Object variants = SimpleJson.extractValue(json, "variants");
        assertInstanceOf(List.class, variants);
        @SuppressWarnings("unchecked")
        List<Object> variantList = (List<Object>) variants;
        assertEquals(1, variantList.size());
        @SuppressWarnings("unchecked")
        Map<String, Object> first = (Map<String, Object>) variantList.get(0);
        assertEquals("A", first.get("name"));

        Object allocation = SimpleJson.extractValue(json, "allocation");
        assertInstanceOf(Map.class, allocation);
        @SuppressWarnings("unchecked")
        Map<String, Object> allocationMap = (Map<String, Object>) allocation;
        assertEquals("A", allocationMap.get("defaultWhenEnabled"));
    }

    @Test
    void extractValue_returnsNullForMissingKeyOrNonObjectRoot() {
        assertNull(SimpleJson.extractValue("{\"enabled\":true}", "variants"));
        assertNull(SimpleJson.extractValue("[1,2,3]", "variants"));
        assertNull(SimpleJson.extractValue(null, "variants"));
    }

    @Test
    void parseVariants_survivesNestedHomonymKeys() {
        String featureJson = "{"
                + "\"featureKey\":\"checkout\","
                + "\"filters\":[{\"name\":\"Targeting\",\"parameters\":{"
                + "\"variants\":\"should-not-win\","
                + "\"allocation\":\"should-not-win\""
                + "}}],"
                + "\"variants\":[{\"name\":\"treatment\",\"configurationValue\":1,\"statusOverride\":\"None\"}],"
                + "\"allocation\":{\"defaultWhenEnabled\":\"treatment\",\"user\":[],\"group\":[],\"percentile\":[]}"
                + "}";

        assertEquals(1, VariantJson.parseVariants(featureJson).size());
        assertEquals("treatment", VariantJson.parseVariants(featureJson).get(0).getName());
        assertTrue(VariantJson.parseAllocation(featureJson) != null);
        assertEquals("treatment", VariantJson.parseAllocation(featureJson).getDefaultWhenEnabled());
    }

    @Test
    void serialize_escapesControlCharactersPerRfc8259() {
        String json = SimpleJson.serialize("a\u0001b\nc");
        assertEquals("\"a\\u0001b\\nc\"", json);
    }

    @Test
    void findMatchingBrace_handlesEscapedBackslashBeforeClosingQuote() {
        // configurationValue ends with a Windows-style path trailing backslash:
        // JSON: "C:\\dir\\"  → after escapes: C:\dir\
        String object = "{\"configurationValue\":\"C:\\\\dir\\\\\",\"name\":\"A\"}";
        int end = SimpleJson.findMatchingBrace(object, 0);
        assertEquals(object.length() - 1, end);
        assertEquals(object, object.substring(0, end + 1));
    }

    @Test
    void splitTopLevelObjects_survivesBracesInsideConfigurationValue() {
        String arrayInterior =
                "{\"featureKey\":\"a\",\"variants\":[{\"name\":\"A\",\"configurationValue\":\"has } brace\"}]},"
                        + "{\"featureKey\":\"b\",\"filters\":[]}";
        List<String> objects = SimpleJson.splitTopLevelObjects(arrayInterior);
        assertEquals(2, objects.size());
        assertTrue(objects.get(0).contains("\"featureKey\":\"a\""));
        assertTrue(objects.get(0).contains("has } brace"));
        assertTrue(objects.get(1).contains("\"featureKey\":\"b\""));
    }

    @Test
    void parseAndSerializePreserveNestedScalarTypesAndEscapes() {
        String json = "{\"items\":[true,false,null,-12,2.5,1e2,\"\\\"quoted\\\"\\n\\t\\u0041\",{}],\"other\":[]}";
        Object parsed = SimpleJson.parseValue(json, new int[]{0});

        assertInstanceOf(Map.class, parsed);
        @SuppressWarnings("unchecked")
        Map<String, Object> object = (Map<String, Object>) parsed;
        assertEquals(List.of(), object.get("other"));
        @SuppressWarnings("unchecked")
        List<Object> items = (List<Object>) object.get("items");
        assertEquals(Boolean.TRUE, items.get(0));
        assertEquals(Boolean.FALSE, items.get(1));
        assertNull(items.get(2));
        assertEquals(-12L, items.get(3));
        assertEquals(2.5, items.get(4));
        assertEquals(100.0, items.get(5));
        assertEquals("\"quoted\"\n\tA", items.get(6));
        assertEquals(Map.of(), items.get(7));
        assertEquals(object, SimpleJson.parseValue(SimpleJson.serialize(object), new int[]{0}));
    }

    @Test
    void scanningAndMalformedInputsTerminateWithoutCrossingStringBoundaries() {
        assertEquals(-1, SimpleJson.findMatchingBrace("{\"open\":1", 0));
        assertEquals(-1, SimpleJson.findMatchingBracket("[\"open\"", 0));
        assertEquals(6, SimpleJson.findMatchingBracket("[\"x]y\"]", 0));
        assertTrue(SimpleJson.splitTopLevelObjects(null).isEmpty());
        assertTrue(SimpleJson.splitTopLevelObjects(" , garbage {\"ok\":true}, {bad").size() == 1);
        assertEquals(false, SimpleJson.isStringDelimiter("\\\"", 1));
        assertEquals(true, SimpleJson.isStringDelimiter("\\\\\"", 2));
        assertNull(SimpleJson.parseValue("?", new int[]{0}));
        int[] position = {0};
        assertEquals(12L, SimpleJson.parseValue("12x", position));
        assertEquals(2, position[0]);
    }
}
