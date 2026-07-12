package io.toggly.core.exception;

/**
 * Exception thrown when ES256 signature verification fails.
 */
public class TogglySignatureException extends TogglyException {

    public TogglySignatureException(String message) {
        super(message);
    }

    public TogglySignatureException(String message, Throwable cause) {
        super(message, cause);
    }
}
