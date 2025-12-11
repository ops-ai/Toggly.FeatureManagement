<?php

namespace Toggly\WordPress\Http;

use Psr\Http\Message\StreamInterface;

/**
 * Simple stream implementation for WordPress
 */
class WordPressStream implements StreamInterface
{
    private string $content;
    private int $position = 0;

    public function __construct(string $content = '')
    {
        $this->content = $content;
    }

    public function __toString(): string
    {
        return $this->content;
    }

    public function close(): void
    {
        // No-op
    }

    public function detach()
    {
        return null;
    }

    public function getSize(): ?int
    {
        return strlen($this->content);
    }

    public function tell(): int
    {
        return $this->position;
    }

    public function eof(): bool
    {
        return $this->position >= strlen($this->content);
    }

    public function isSeekable(): bool
    {
        return true;
    }

    public function seek($offset, $whence = SEEK_SET): void
    {
        if ($whence === SEEK_SET) {
            $this->position = $offset;
        } elseif ($whence === SEEK_CUR) {
            $this->position += $offset;
        } elseif ($whence === SEEK_END) {
            $this->position = strlen($this->content) + $offset;
        }
    }

    public function rewind(): void
    {
        $this->position = 0;
    }

    public function isWritable(): bool
    {
        return true;
    }

    public function write($string): int
    {
        $length = strlen($string);
        $this->content = substr_replace($this->content, $string, $this->position, $length);
        $this->position += $length;
        return $length;
    }

    public function isReadable(): bool
    {
        return true;
    }

    public function read($length): string
    {
        $result = substr($this->content, $this->position, $length);
        $this->position += strlen($result);
        return $result;
    }

    public function getContents(): string
    {
        $result = substr($this->content, $this->position);
        $this->position = strlen($this->content);
        return $result;
    }

    public function getMetadata($key = null)
    {
        return null;
    }
}
