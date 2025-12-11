<?php

namespace Toggly\WordPress\Storage;

use Psr\SimpleCache\CacheInterface;

/**
 * WordPress cache adapter implementing PSR-16
 */
class WordPressCacheAdapter implements CacheInterface
{
    private int $defaultTtl;

    public function __construct(int $defaultTtl = 3600)
    {
        $this->defaultTtl = $defaultTtl;
    }

    public function get($key, $default = null)
    {
        $value = get_transient($key);
        return $value !== false ? $value : $default;
    }

    public function set($key, $value, $ttl = null): bool
    {
        $ttl = $ttl ?? $this->defaultTtl;
        return set_transient($key, $value, $ttl);
    }

    public function delete($key): bool
    {
        return delete_transient($key);
    }

    public function clear(): bool
    {
        global $wpdb;
        $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_%' OR option_name LIKE '_transient_timeout_%'");
        return true;
    }

    public function getMultiple($keys, $default = null): iterable
    {
        $results = [];
        foreach ($keys as $key) {
            $results[$key] = $this->get($key, $default);
        }
        return $results;
    }

    public function setMultiple($values, $ttl = null): bool
    {
        $success = true;
        foreach ($values as $key => $value) {
            if (!$this->set($key, $value, $ttl)) {
                $success = false;
            }
        }
        return $success;
    }

    public function deleteMultiple($keys): bool
    {
        $success = true;
        foreach ($keys as $key) {
            if (!$this->delete($key)) {
                $success = false;
            }
        }
        return $success;
    }

    public function has($key): bool
    {
        return get_transient($key) !== false;
    }
}
