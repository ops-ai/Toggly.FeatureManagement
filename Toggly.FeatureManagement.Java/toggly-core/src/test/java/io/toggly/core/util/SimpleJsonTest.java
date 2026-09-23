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
    void isStringDelimiter_distinguishesEscapedQuoteFromEscapedBackslash() {
        // Java "\"a\\\"b\"" → chars: " a \ " b "
        String escapedQuote = "\"a\\\"b\"";
        assertTrue(SimpleJson.isStringDelimiter(escapedQuote, 0));
        assertTrue(!SimpleJson.isStringDelimiter(escapedQuote, 3)); // \"
        assertTrue(SimpleJson.isStringDelimiter(escapedQuote, 5));

        // Java "\"a\\\\\"" → chars: " a \ \ "
        String escapedBackslashThenQuote = "\"a\\\\\"";
        assertTrue(SimpleJson.isStringDelimiter(escapedBackslashThenQuote, 0));
        assertTrue(SimpleJson.isStringDelimiter(escapedBackslashThenQuote, 4));
    }
}
