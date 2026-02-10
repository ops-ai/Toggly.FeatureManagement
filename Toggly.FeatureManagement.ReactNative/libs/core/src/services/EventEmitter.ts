import type { TogglyEvent, TogglyEventListener, TogglyEventType } from '../models';

/**
 * Simple event emitter for Toggly SDK events.
 * Allows subscribing to various lifecycle events.
 */
export class EventEmitter {
  private listeners: Map<TogglyEventType, Set<TogglyEventListener>> = new Map();
  private allListeners: Set<TogglyEventListener> = new Set();

  /**
   * Subscribe to a specific event type
   * @param eventType Event type to listen for
   * @param listener Callback function
   * @returns Unsubscribe function
   */
  on(eventType: TogglyEventType, listener: TogglyEventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  /**
   * Subscribe to all events
   * @param listener Callback function
   * @returns Unsubscribe function
   */
  onAll(listener: TogglyEventListener): () => void {
    this.allListeners.add(listener);

    return () => {
      this.allListeners.delete(listener);
    };
  }

  /**
   * Unsubscribe from a specific event type
   * @param eventType Event type
   * @param listener Callback function to remove
   */
  off(eventType: TogglyEventType, listener: TogglyEventListener): void {
    this.listeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit an event to all subscribers
   * @param eventType Event type
   * @param data Optional event data
   */
  emit(eventType: TogglyEventType, data?: unknown): void {
    const event: TogglyEvent = {
      type: eventType,
      timestamp: new Date(),
      data,
    };

    // Notify specific event listeners
    this.listeners.get(eventType)?.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(`[Toggly] Error in event listener for "${eventType}":`, error);
      }
    });

    // Notify all-event listeners
    this.allListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(`[Toggly] Error in all-event listener:`, error);
      }
    });
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.allListeners.clear();
  }

  /**
   * Get the number of listeners for a specific event type
   */
  listenerCount(eventType: TogglyEventType): number {
    return (this.listeners.get(eventType)?.size ?? 0) + this.allListeners.size;
  }
}
