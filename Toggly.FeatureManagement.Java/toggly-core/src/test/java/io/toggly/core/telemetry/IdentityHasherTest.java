package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IdentityHasherTest {

    @Test
    void matchesGoAndNodeFnv1aUtf8Fixtures() {
        assertThat(IdentityHasher.hashIdentity("alice")).isEqualTo(-2027809817);
        assertThat(IdentityHasher.hashIdentity("café")).isEqualTo(-1473556407);
        assertThat(IdentityHasher.hashIdentity("🚀")).isEqualTo(2141686490);
        assertThat(IdentityHasher.hashIdentity("alice")).isEqualTo(IdentityHasher.hashIdentity("alice"));
        assertThat(IdentityHasher.hashIdentity("alice")).isNotEqualTo(IdentityHasher.hashIdentity("bob"));
    }

    @Test
    void utf8MultiByteDiffersFromUtf16CodeUnitHashing() {
        int utf16Style = (int) 2166136261L;
        String cafe = "café";
        for (int i = 0; i < cafe.length(); i++) {
            utf16Style ^= cafe.charAt(i);
            utf16Style *= 16777619;
        }
        assertThat(IdentityHasher.hashIdentity(cafe)).isNotEqualTo(utf16Style);
    }
}
