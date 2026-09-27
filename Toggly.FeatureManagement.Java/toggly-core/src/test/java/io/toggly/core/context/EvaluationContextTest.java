package io.toggly.core.context;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EvaluationContextTest {

    @Test
    void builderCopiesTargetingDataAndWithMethodsKeepOriginalImmutable() {
        Set<String> groups = new HashSet<>(Set.of("beta"));
        Map<String, Object> traits = new HashMap<>(Map.of("age", 42));
        Map<String, String> claims = new HashMap<>(Map.of("role", "admin"));
        RequestContext request = RequestContext.builder().country("US").build();
        TogglyEntityContext entity = new TogglyEntityContext("Account", "a", Map.of());
        EvaluationContext context = EvaluationContext.builder()
                .identity("user")
                .groups(groups)
                .traits(traits)
                .claims(claims)
                .request(request)
                .entity(entity)
                .build();
        groups.clear();
        traits.clear();
        claims.clear();

        assertThat(context.getIdentity()).isEqualTo("user");
        assertThat(context.hasGroup("beta")).isTrue();
        assertThat(context.hasAnyGroup(Set.of("other", "beta"))).isTrue();
        assertThat(context.hasAnyGroup(Set.of("other"))).isFalse();
        assertThat(context.getTrait("age")).isEqualTo(42);
        assertThat(context.getTraitAsString("age")).isEqualTo("42");
        assertThat(context.getTraitAsString("missing")).isNull();
        assertThat(context.getClaims()).containsEntry("role", "admin");
        assertThat(context.getRequest()).isSameAs(request);
        assertThat(context.getEntity()).isSameAs(entity);
        assertThatThrownBy(() -> context.getGroups().add("other"))
                .isInstanceOf(UnsupportedOperationException.class);
        assertThat(context.withIdentity("other").getIdentity()).isEqualTo("other");
        assertThat(context.withGroup("other").getGroups()).contains("beta", "other");
        assertThat(context.withTrait("tier", "gold").getTrait("tier")).isEqualTo("gold");
        assertThat(context.withClaims(null).getClaims()).isEmpty();
        assertThat(context.withRequest(null).getRequest()).isNull();
        assertThat(context.withEntity(null).getEntity()).isNull();
        assertThat(context.getGroups()).containsExactly("beta");
        assertThat(context).isEqualTo(context).isNotEqualTo(null).isNotEqualTo("user");
    }

    @Test
    void iterableGroupsDropNullAndContextValueEqualityIsStable() {
        EvaluationContext first = EvaluationContext.builder()
                .groups(List.of("beta", "admin"))
                .addGroup(null)
                .claim(null, "ignored")
                .claim("role", "admin")
                .build();
        EvaluationContext second = EvaluationContext.builder()
                .groups(Set.of("admin", "beta"))
                .claim("role", "admin")
                .build();

        assertThat(first).isEqualTo(second).hasSameHashCodeAs(second);
        assertThat(EvaluationContext.empty().getGroups()).isEmpty();
        assertThat(EvaluationContext.forIdentity("user").getIdentity()).isEqualTo("user");
        assertThat(first.toString()).contains("admin", "beta");
    }
}
