package io.toggly.core;

import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.exception.TogglyException;
import io.toggly.core.model.VariantResult;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TogglyFacadeTest {

    @AfterEach
    void tearDown() {
        Toggly.shutdown();
        ContextHolder.clear();
    }

    @Test
    void initializationReplacesAndClosesPreviousClient() {
        TogglyClient oldClient = mock(TogglyClient.class);
        TogglyClient newClient = mock(TogglyClient.class);

        assertThat(Toggly.isInitialized()).isFalse();
        assertThatThrownBy(Toggly::client).isInstanceOf(TogglyException.class)
                .hasMessageContaining("not initialized");
        Toggly.initialize(oldClient);
        Toggly.initialize(newClient);

        assertThat(Toggly.isInitialized()).isTrue();
        assertThat(Toggly.client()).isSameAs(newClient);
        verify(oldClient).close();
        Toggly.shutdown();
        verify(newClient).close();
        assertThat(Toggly.isInitialized()).isFalse();
    }

    @Test
    void delegatesEvaluationAndVariantCallsToConfiguredClient() {
        TogglyClient client = mock(TogglyClient.class);
        EvaluationContext context = EvaluationContext.builder().identity("user").build();
        VariantResult variant = new VariantResult("treatment", "value", true);
        when(client.isEnabled("flag")).thenReturn(true);
        when(client.isEnabled("flag", context)).thenReturn(false);
        when(client.getVariant("flag")).thenReturn(variant);
        when(client.getVariant("flag", context)).thenReturn(variant);
        when(client.getVariantValue("flag")).thenReturn("value");
        when(client.getVariantValue("flag", context)).thenReturn("context-value");
        when(client.getVariantValue(String.class, "flag")).thenReturn("value");
        when(client.getVariantValue(String.class, "flag", context)).thenReturn("context-value");
        Toggly.initialize(client);

        assertThat(Toggly.isEnabled("flag")).isTrue();
        assertThat(Toggly.isEnabled("flag", context)).isFalse();
        assertThat(Toggly.getVariant("flag")).isSameAs(variant);
        assertThat(Toggly.getVariant("flag", context)).isSameAs(variant);
        assertThat(Toggly.getVariantValue("flag")).isEqualTo("value");
        assertThat(Toggly.getVariantValue("flag", context)).isEqualTo("context-value");
        assertThat(Toggly.getVariantValue(String.class, "flag")).isEqualTo("value");
        assertThat(Toggly.getVariantValue(String.class, "flag", context)).isEqualTo("context-value");
        Toggly.refresh();
        verify(client).refresh();
    }

    @Test
    void nestedContextScopeRestoresPreviousContextAfterException() {
        EvaluationContext original = EvaluationContext.builder().identity("original").build();
        EvaluationContext temporary = EvaluationContext.builder().identity("temporary").build();
        Toggly.setContext(original);

        assertThatThrownBy(() -> Toggly.withContext(temporary, () -> {
            assertThat(ContextHolder.getContext()).isSameAs(temporary);
            throw new IllegalStateException("expected");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(ContextHolder.getContext()).isSameAs(original);
        Toggly.clearContext();
        assertThat(ContextHolder.getContext()).isNull();
    }
}
