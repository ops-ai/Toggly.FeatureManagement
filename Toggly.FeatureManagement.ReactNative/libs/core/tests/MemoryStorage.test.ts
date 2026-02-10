import { MemoryStorage } from '../src/services/MemoryStorage';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      const result = await storage.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return stored value', async () => {
      await storage.set('key', 'value');
      const result = await storage.get('key');
      expect(result).toBe('value');
    });
  });

  describe('set', () => {
    it('should store a value', async () => {
      await storage.set('key', 'value');
      const result = await storage.get('key');
      expect(result).toBe('value');
    });

    it('should overwrite existing value', async () => {
      await storage.set('key', 'value1');
      await storage.set('key', 'value2');
      const result = await storage.get('key');
      expect(result).toBe('value2');
    });

    it('should handle empty string value', async () => {
      await storage.set('key', '');
      const result = await storage.get('key');
      expect(result).toBe('');
    });

    it('should handle JSON string values', async () => {
      const jsonValue = JSON.stringify({ nested: { data: true } });
      await storage.set('json', jsonValue);
      const result = await storage.get('json');
      expect(result).toBe(jsonValue);
      expect(JSON.parse(result!)).toEqual({ nested: { data: true } });
    });
  });

  describe('delete', () => {
    it('should delete a value', async () => {
      await storage.set('key', 'value');
      await storage.delete('key');
      const result = await storage.get('key');
      expect(result).toBeNull();
    });

    it('should not throw for non-existent key', async () => {
      await expect(storage.delete('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all values', async () => {
      await storage.set('key1', 'value1');
      await storage.set('key2', 'value2');

      storage.clear();

      expect(await storage.get('key1')).toBeNull();
      expect(await storage.get('key2')).toBeNull();
    });
  });

  describe('keys', () => {
    it('should return all keys', async () => {
      await storage.set('key1', 'value1');
      await storage.set('key2', 'value2');
      await storage.set('key3', 'value3');

      const keys = storage.keys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should return empty array when empty', () => {
      const keys = storage.keys();
      expect(keys).toEqual([]);
    });
  });
});
