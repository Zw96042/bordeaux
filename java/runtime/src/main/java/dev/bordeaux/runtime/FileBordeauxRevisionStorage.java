package dev.bordeaux.runtime;

import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Filesystem implementation that atomically replaces only the runtime state manifest. */
final class FileBordeauxRevisionStorage implements BordeauxRevisionStorage {
    static final int MAX_STATE_BYTES = 1024 * 1024;
    private static final ConcurrentHashMap<Path, ReentrantLock> PROCESS_LOCKS = new ConcurrentHashMap<>();
    private final Path stateDirectory;
    private final Path stateFile;
    private final Path revisionsDirectory;
    private final Path lockFile;
    private final ReentrantLock processLock;

    FileBordeauxRevisionStorage(Path stateDirectory) {
        if (stateDirectory == null) throw new IllegalArgumentException("stateDirectory is required");
        this.stateDirectory = stateDirectory.toAbsolutePath().normalize();
        this.stateFile = this.stateDirectory.resolve("runtime-state.json");
        this.revisionsDirectory = this.stateDirectory.resolve("revisions");
        this.lockFile = this.stateDirectory.resolve("runtime-state.lock");
        this.processLock = PROCESS_LOCKS.computeIfAbsent(this.stateDirectory, ignored -> new ReentrantLock());
    }

    @Override
    public Optional<byte[]> readState() {
        try {
            if (!Files.exists(stateFile)) return Optional.empty();
            byte[] state;
            try (InputStream input = Files.newInputStream(stateFile)) {
                state = input.readNBytes(MAX_STATE_BYTES + 1);
            }
            if (state.length > MAX_STATE_BYTES) {
                throw new BordeauxRuntimeException("Persisted Bordeaux runtime state exceeds the size limit of "
                        + MAX_STATE_BYTES + " bytes");
            }
            return Optional.of(state);
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not read the persisted Bordeaux runtime state", exception);
        }
    }

    @Override
    public void writeRevision(String revisionId, byte[] payload) {
        String digest = digest(revisionId);
        Path target = revisionsDirectory.resolve(digest + ".bdx");
        try {
            if (Files.exists(target)) {
                if (Files.size(target) > BordeauxRevisionReader.MAX_PAYLOAD_BYTES) {
                    throw new BordeauxRuntimeException("Stored immutable revision exceeds the payload size limit");
                }
                if (!contentEquals(target, payload)) {
                    throw new BordeauxRuntimeException("Immutable revision payload differs from its existing revision ID");
                }
                return;
            }
            atomicWrite(target, payload, false);
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not persist immutable Bordeaux revision " + revisionId, exception);
        }
    }

    @Override
    public byte[] readRevision(String revisionId, String payloadSha256) {
        Path target = revisionsDirectory.resolve(digest(revisionId) + ".bdx");
        try {
            if (!Files.isRegularFile(target, java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
                throw new BordeauxRuntimeException("Retained Bordeaux revision payload is missing");
            }
            byte[] contents;
            try (InputStream input = Files.newInputStream(target)) {
                contents = input.readNBytes(BordeauxRevisionReader.MAX_PAYLOAD_BYTES + 1);
            }
            if (contents.length > BordeauxRevisionReader.MAX_PAYLOAD_BYTES) {
                throw new BordeauxRuntimeException("Retained Bordeaux revision exceeds the payload size limit");
            }
            if (!payloadSha256.equals(sha256(contents))) {
                throw new BordeauxRuntimeException("Retained Bordeaux revision payload is missing or corrupt");
            }
            return contents;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not read retained Bordeaux revision", exception);
        }
    }

    @Override
    public void deleteRevision(String revisionId) {
        Path target = revisionsDirectory.resolve(digest(revisionId) + ".bdx");
        try {
            if (Files.isSymbolicLink(target)) {
                throw new BordeauxRuntimeException("Retained Bordeaux revision must not be a symbolic link");
            }
            Files.deleteIfExists(target);
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not remove released Bordeaux revision " + revisionId, exception);
        }
    }

    @Override
    public boolean revisionPresent(String revisionId) {
        Path target = revisionsDirectory.resolve(digest(revisionId) + ".bdx");
        try {
            return Files.isRegularFile(target, java.nio.file.LinkOption.NOFOLLOW_LINKS)
                    && Files.size(target) <= BordeauxRevisionReader.MAX_PAYLOAD_BYTES;
        } catch (IOException exception) {
            return false;
        }
    }

    @Override
    public void writeState(byte[] state) {
        try {
            atomicWrite(stateFile, state, true);
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not atomically replace Bordeaux runtime state", exception);
        }
    }

    @Override
    public boolean revisionMatches(String revisionId, String payloadSha256) {
        Path target = revisionsDirectory.resolve(digest(revisionId) + ".bdx");
        try {
            if (!Files.isRegularFile(target) || Files.size(target) > BordeauxRevisionReader.MAX_PAYLOAD_BYTES) return false;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = Files.newInputStream(target)) {
                byte[] buffer = new byte[8192];
                long read = 0;
                for (int count; (count = input.read(buffer)) >= 0;) {
                    if (count == 0) continue;
                    read += count;
                    if (read > BordeauxRevisionReader.MAX_PAYLOAD_BYTES) return false;
                    digest.update(buffer, 0, count);
                }
            }
            return payloadSha256.equals("sha256:" + HexFormat.of().formatHex(digest.digest()));
        } catch (IOException | NoSuchAlgorithmException exception) {
            return false;
        }
    }

    @Override
    public <T> T withExclusiveLock(Supplier<T> action) {
        processLock.lock();
        try {
            Files.createDirectories(stateDirectory);
            try (FileChannel channel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                    FileLock ignored = channel.lock()) {
                return action.get();
            }
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not lock the Bordeaux runtime state directory", exception);
        } finally {
            processLock.unlock();
        }
    }

    private static String sha256(byte[] contents) {
        try {
            return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(contents));
        } catch (NoSuchAlgorithmException exception) {
            throw new BordeauxRuntimeException("SHA-256 is unavailable", exception);
        }
    }

    private static void atomicWrite(Path target, byte[] contents, boolean replace) throws IOException {
        Files.createDirectories(target.getParent());
        Path temporary = Files.createTempFile(target.getParent(), target.getFileName().toString(), ".tmp");
        try {
            Files.write(temporary, contents, StandardOpenOption.TRUNCATE_EXISTING);
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                channel.force(true);
            }
            if (replace) {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } else {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
            }
        } catch (AtomicMoveNotSupportedException exception) {
            throw new IOException("Atomic file replacement is required for Bordeaux runtime state", exception);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static boolean contentEquals(Path path, byte[] expected) throws IOException {
        if (Files.size(path) != expected.length) return false;
        try (InputStream input = Files.newInputStream(path)) {
            byte[] buffer = new byte[8192];
            int offset = 0;
            for (int count; (count = input.read(buffer)) >= 0;) {
                if (count == 0) continue;
                if (offset + count > expected.length) return false;
                if (!Arrays.equals(buffer, 0, count, expected, offset, offset + count)) return false;
                offset += count;
            }
            return offset == expected.length;
        }
    }

    private static String digest(String revisionId) {
        if (revisionId == null || !revisionId.matches("sha256:[0-9a-f]{64}")) {
            throw new BordeauxRuntimeException("Revision IDs must use sha256:<64 lowercase hex characters>");
        }
        return revisionId.substring("sha256:".length());
    }
}
