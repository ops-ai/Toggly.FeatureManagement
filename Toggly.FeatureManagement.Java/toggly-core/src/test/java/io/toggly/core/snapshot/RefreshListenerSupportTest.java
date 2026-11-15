package io.toggly.core.snapshot;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class RefreshListenerSupportTest {

    @Test
    void addRemoveAndNotifyIgnoreNullAndIsolateThrowingListeners() {
        RefreshListenerSupport support = new RefreshListenerSupport(RefreshListenerSupportTest.class);
        List<FeatureSnapshot> seen = new ArrayList<>();
        AtomicInteger goodCalls = new AtomicInteger();
        Consumer<FeatureSnapshot> recorder = seen::add;

        support.add(null);
        support.remove(null);
        support.add(recorder);
        support.add(recorder); // duplicate ignored
        support.add(snapshot -> {
            throw new IllegalStateException("boom");
        });
        support.add(snapshot -> goodCalls.incrementAndGet());

        FeatureSnapshot snapshot = FeatureSnapshot.empty();
        assertThatCode(() -> support.notifyListeners(snapshot)).doesNotThrowAnyException();
        assertThat(seen).containsExactly(snapshot);
        assertThat(goodCalls).hasValue(1);

        support.remove(recorder);
        support.notifyListeners(snapshot);
        assertThat(seen).containsExactly(snapshot);
        assertThat(goodCalls).hasValue(2);
    }
}
