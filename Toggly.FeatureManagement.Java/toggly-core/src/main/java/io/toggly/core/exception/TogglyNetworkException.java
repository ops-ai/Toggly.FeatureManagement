package io.toggly.core.exception;

/**
 * Exception thrown when network operations fail.
 */
public class TogglyNetworkException extends TogglyException {

    private final int statusCode;

    public TogglyNetworkException(String message) {
        super(message);
        this.statusCode = -1;
    }

    public TogglyNetworkException(String message, int statusCode) {
        super(message);
        this.statusCode = statusCode;
    }

    public TogglyNetworkException(String message, Throwable cause) {
        super(message, cause);
        this.statusCode = -1;
    }

    /**
     * Gets the HTTP status code if available.
     *
     * @return the status code or -1 if not applicable
     */
    public int getStatusCode() {
        return statusCode;
    }
}
