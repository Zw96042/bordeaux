package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.junit.jupiter.api.Test;

class BoundedInputStreamTest {
    @Test
    void acceptsAnExactBudgetAndLeavesTheCallerStreamOpen() throws IOException {
        TrackingInput input = new TrackingInput(new byte[] {1, 2, 3});
        try (var bounded = new BoundedInputStream(input, 3, "budget exceeded")) {
            assertArrayEquals(new byte[] {1, 2, 3}, bounded.readAllBytes());
            assertEquals(-1, bounded.read());
        }
        assertFalse(input.closed);
    }

    @Test
    void boundsBulkAcquisitionToOneOverflowByte() {
        TrackingInput input = new TrackingInput(new byte[100]);
        var bounded = new BoundedInputStream(input, 3, "revision byte limit");

        IOException failure = assertThrows(IOException.class, bounded::readAllBytes);

        assertEquals("revision byte limit", failure.getMessage());
        assertEquals(4, input.consumed());
        assertThrows(IOException.class, bounded::read);
        assertEquals(4, input.consumed());
    }

    @Test
    void countsSingleByteAndBulkReadsAgainstTheSameBudget() throws IOException {
        TrackingInput input = new TrackingInput(new byte[] {1, 2, 3, 4, 5});
        var bounded = new BoundedInputStream(input, 3, "control byte limit");

        assertEquals(1, bounded.read());
        assertArrayEquals(new byte[] {2, 3}, bounded.readNBytes(2));
        assertThrows(IOException.class, bounded::read);
        assertEquals(4, input.consumed());
        assertEquals(0, bounded.read(new byte[1], 0, 0));
    }

    private static final class TrackingInput extends ByteArrayInputStream {
        private boolean closed;

        private TrackingInput(byte[] bytes) {
            super(bytes);
        }

        private int consumed() {
            return pos;
        }

        @Override
        public void close() {
            closed = true;
        }
    }
}
