package dev.bordeaux.runtime;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;

/** Enforces a byte budget without closing the caller's stream or reading beyond one overflow byte. */
final class BoundedInputStream extends InputStream {
    private final InputStream delegate;
    private final long maxBytes;
    private final String overflowMessage;
    private long read;

    BoundedInputStream(InputStream delegate, long maxBytes, String overflowMessage) {
        this.delegate = delegate;
        this.maxBytes = maxBytes;
        this.overflowMessage = overflowMessage;
    }

    @Override
    public int read() throws IOException {
        if (read > maxBytes) throw new IOException(overflowMessage);
        int value = delegate.read();
        if (value >= 0) add(1);
        return value;
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        Objects.checkFromIndexSize(offset, length, buffer.length);
        if (length == 0) return 0;
        long remainingWithOverflowSentinel = maxBytes - read + 1;
        if (remainingWithOverflowSentinel <= 0) throw new IOException(overflowMessage);
        int count = delegate.read(buffer, offset, (int) Math.min(length, remainingWithOverflowSentinel));
        if (count > 0) add(count);
        return count;
    }

    private void add(int count) throws IOException {
        read += count;
        if (read > maxBytes) throw new IOException(overflowMessage);
    }
}
