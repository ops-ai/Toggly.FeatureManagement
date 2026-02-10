import { EventEmitter } from '../src/services/EventEmitter';
import type { TogglyEventType } from '../src/models';

describe('EventEmitter', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe('on', () => {
    it('should subscribe to specific event type', () => {
      const listener = jest.fn();

      emitter.on('initialized', listener);
      emitter.emit('initialized');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initialized',
          timestamp: expect.any(Date),
        })
      );
    });

    it('should not trigger for other event types', () => {
      const listener = jest.fn();

      emitter.on('initialized', listener);
      emitter.emit('refreshed');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should allow multiple listeners for same event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('initialized', listener1);
      emitter.on('initialized', listener2);
      emitter.emit('initialized');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const listener = jest.fn();

      const unsubscribe = emitter.on('initialized', listener);
      unsubscribe();
      emitter.emit('initialized');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('onAll', () => {
    it('should receive all events', () => {
      const listener = jest.fn();

      emitter.onAll(listener);
      emitter.emit('initialized');
      emitter.emit('refreshed');
      emitter.emit('error');

      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('should return unsubscribe function', () => {
      const listener = jest.fn();

      const unsubscribe = emitter.onAll(listener);
      unsubscribe();
      emitter.emit('initialized');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('should remove specific listener', () => {
      const listener = jest.fn();

      emitter.on('initialized', listener);
      emitter.off('initialized', listener);
      emitter.emit('initialized');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('emit', () => {
    it('should pass data to listeners', () => {
      const listener = jest.fn();
      const data = { key: 'value' };

      emitter.on('refreshed', listener);
      emitter.emit('refreshed', data);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'refreshed',
          data,
        })
      );
    });

    it('should handle listener errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const errorListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const normalListener = jest.fn();

      emitter.on('initialized', errorListener);
      emitter.on('initialized', normalListener);
      emitter.emit('initialized');

      expect(consoleSpy).toHaveBeenCalled();
      expect(normalListener).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle all-listener errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const errorListener = jest.fn(() => {
        throw new Error('All listener error');
      });

      emitter.onAll(errorListener);
      emitter.emit('initialized');

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const allListener = jest.fn();

      emitter.on('initialized', listener1);
      emitter.on('refreshed', listener2);
      emitter.onAll(allListener);

      emitter.removeAllListeners();

      emitter.emit('initialized');
      emitter.emit('refreshed');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(allListener).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('should return correct count for event type', () => {
      emitter.on('initialized', jest.fn());
      emitter.on('initialized', jest.fn());
      emitter.on('refreshed', jest.fn());
      emitter.onAll(jest.fn());

      expect(emitter.listenerCount('initialized')).toBe(3); // 2 specific + 1 all
      expect(emitter.listenerCount('refreshed')).toBe(2); // 1 specific + 1 all
      expect(emitter.listenerCount('error')).toBe(1); // 0 specific + 1 all
    });
  });
});
