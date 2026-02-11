package io.toggly.core.exception;

/**
 * Base exception for Toggly errors.
 */
public class TogglyException extends RuntimeException {

    public TogglyException(String message) {
        super(message);
    }

    public TogglyException(String message, Throwable cause) {
        super(message, cause);
    }
}
