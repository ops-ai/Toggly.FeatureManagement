package io.toggly.core.exception;

/**
 * Exception thrown when configuration is invalid.
 */
public class TogglyConfigException extends TogglyException {

    public TogglyConfigException(String message) {
        super(message);
    }

    public TogglyConfigException(String message, Throwable cause) {
        super(message, cause);
    }
}
