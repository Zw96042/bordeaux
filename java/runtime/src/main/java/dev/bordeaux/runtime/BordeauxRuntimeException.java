package dev.bordeaux.runtime;

/** A trajectory contract, command lookup, or argument-conversion failure. */
public final class BordeauxRuntimeException extends RuntimeException {
    public BordeauxRuntimeException(String message) {
        super(message);
    }

    public BordeauxRuntimeException(String message, Throwable cause) {
        super(message, cause);
    }
}
