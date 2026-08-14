package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Objects;

/**
 * Publishes the local robot runtime state for a paired Bordeaux desktop over its constrained file-transfer boundary.
 * This class only writes {@value #STATUS_FILE_NAME}; it does not open sockets, watch directories, invoke commands,
 * or activate revisions.
 */
public final class BordeauxRobotStatusPublisher {
    public static final String PROTOCOL_VERSION = "bordeaux-robot-push/1.0";
    public static final String PRODUCTION_DEPLOYMENT_NAMESPACE = "/home/lvuser/deploy/bordeaux/push-v1";
    public static final int MAX_STATUS_BYTES = 16 * 1024;
    private static final String STATUS_FILE_NAME = "status.json";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Path namespace;
    private final Path statusFile;

    /**
     * Creates a publisher rooted at an already-provisioned deployment namespace. Tests may use a scoped directory;
     * production callers use {@link #PRODUCTION_DEPLOYMENT_NAMESPACE}.
     */
    public BordeauxRobotStatusPublisher(Path namespace) {
        this.namespace = requireSafeDirectory(namespace, "Bordeaux deployment namespace");
        this.statusFile = this.namespace.resolve(STATUS_FILE_NAME);
    }

    /** Atomically replaces the bounded status document and returns its fixed path. */
    public Path publish(BordeauxRuntimeStatus status) {
        Objects.requireNonNull(status, "status");
        requireSafeDirectory(namespace, "Bordeaux deployment namespace");
        rejectSymbolicLink(statusFile, "Bordeaux status file");
        byte[] document = serialize(status);
        if (document.length > MAX_STATUS_BYTES) {
            throw new BordeauxRuntimeException("Bordeaux robot status exceeds the size limit of "
                    + MAX_STATUS_BYTES + " bytes");
        }
        writeAtomically(document);
        return statusFile;
    }

    static Path requireSafeDirectory(Path path, String name) {
        if (path == null) throw new BordeauxRuntimeException(name + " is required");
        Path directory = path.toAbsolutePath().normalize();
        for (Path current = directory; current != null; current = current.getParent()) {
            rejectSymbolicLink(current, name);
        }
        if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
            throw new BordeauxRuntimeException(name + " must be an existing directory");
        }
        return directory;
    }

    static void rejectSymbolicLink(Path path, String name) {
        if (Files.isSymbolicLink(path)) {
            throw new BordeauxRuntimeException(name + " must not be a symbolic link");
        }
    }

    private static byte[] serialize(BordeauxRuntimeStatus status) {
        ObjectNode document = MAPPER.createObjectNode();
        document.put("protocolVersion", PROTOCOL_VERSION);
        document.put("deploymentNamespace", PRODUCTION_DEPLOYMENT_NAMESPACE);
        document.put("runtimeId", status.runtimeId());
        document.put("teamNumber", status.teamNumber());
        document.put("disabled", status.disabled());
        document.put("catalogId", status.catalogId());
        document.put("catalogHash", status.catalogHash());
        document.put("supportVersion", status.supportVersion());
        document.put("fieldId", status.fieldId());
        document.put("fieldRevision", status.fieldRevision());
        document.put("fieldCoordinateSchemaId", status.fieldCoordinateSchemaId());
        if (status.activeRevisionId() == null) document.putNull("activeRevisionId");
        else document.put("activeRevisionId", status.activeRevisionId());
        if (status.activePayloadSha256() == null) document.putNull("activePayloadSha256");
        else document.put("activePayloadSha256", status.activePayloadSha256());
        ArrayNode health = document.putArray("health");
        status.health().forEach(health::add);
        try {
            return MAPPER.writeValueAsBytes(document);
        } catch (JsonProcessingException exception) {
            throw new BordeauxRuntimeException("Could not serialize Bordeaux robot status", exception);
        }
    }

    private void writeAtomically(byte[] document) {
        Path temporary = null;
        try {
            temporary = Files.createTempFile(namespace, ".status-", ".tmp");
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(document);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            try {
                Files.move(temporary, statusFile, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                throw new BordeauxRuntimeException("Atomic replacement is required for Bordeaux robot status", exception);
            }
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not publish Bordeaux robot status", exception);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // The temporary file is inside the scoped namespace and cannot affect the published status.
                }
            }
        }
    }
}
