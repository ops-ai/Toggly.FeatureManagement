package io.toggly.core.snapshot;

import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Shared storage and safe notification for {@link SnapshotProvider} refresh listeners.
 *
 * <p>Used by HTTP, in-memory, and caching providers so add/remove/notify logic is not duplicated.</p>
 */
public final class RefreshListenerSupport {

    private final Logger logger;
    private final CopyOnWriteArrayList<Consumer<FeatureSnapshot>> listeners = new CopyOnWriteArrayList<>();

    /**
     * @param owner class whose logger name is used when a listener throws
     */
    public RefreshListenerSupport(Class<?> owner) {
        this.logger = Logger.getLogger(owner.getName());
    }

    /**
     * Registers a listener if non-null and not already present.
     *
     * @param listener callback to register
     */
    public void add(Consumer<FeatureSnapshot> listener) {
        if (listener != null) {
            listeners.addIfAbsent(listener);
        }
    }

    /**
     * Removes a previously registered listener.
     *
     * @param listener callback to remove
     */
    public void remove(Consumer<FeatureSnapshot> listener) {
        if (listener != null) {
            listeners.remove(listener);
        }
    }

    /**
     * Invokes all listeners with {@code snapshot}, catching and logging exceptions.
     *
     * @param snapshot the applied snapshot
     */
    public void notifyListeners(FeatureSnapshot snapshot) {
        for (Consumer<FeatureSnapshot> listener : listeners) {
            try {
                listener.accept(snapshot);
            } catch (Exception e) {
                logger.log(Level.WARNING, "Refresh listener threw", e);
            }
        }
    }
}
