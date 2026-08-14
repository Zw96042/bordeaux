package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BordeauxRobotStatusPublisherTest {
    private static final String HASH = "sha256:" + "a".repeat(64);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path temporaryDirectory;

    @Test
    void publishesTheCompleteBoundedPairingStatusAtomicallyInsideItsScopedNamespace() throws IOException {
        Path namespace = Files.createDirectory(temporaryDirectory.resolve("push-v1"));
        BordeauxRobotStatusPublisher publisher = new BordeauxRobotStatusPublisher(namespace);
        BordeauxRuntimeStatus status = status();

        Path published = publisher.publish(status);

        assertEquals(namespace.resolve("status.json"), published);
        JsonNode document = MAPPER.readTree(Files.readAllBytes(published));
        assertEquals("bordeaux-robot-push/1.0", document.path("protocolVersion").textValue());
        assertEquals("/home/lvuser/deploy/bordeaux/push-v1", document.path("deploymentNamespace").textValue());
        assertEquals(status.teamNumber(), document.path("teamNumber").intValue());
        assertEquals(status.runtimeId(), document.path("runtimeId").textValue());
        assertEquals(status.disabled(), document.path("disabled").booleanValue());
        assertEquals(status.catalogId(), document.path("catalogId").textValue());
        assertEquals(status.catalogHash(), document.path("catalogHash").textValue());
        assertEquals(status.supportVersion(), document.path("supportVersion").textValue());
        assertEquals(status.fieldId(), document.path("fieldId").textValue());
        assertEquals(status.fieldRevision(), document.path("fieldRevision").textValue());
        assertEquals(status.fieldCoordinateSchemaId(), document.path("fieldCoordinateSchemaId").textValue());
        assertEquals(status.activeRevisionId(), document.path("activeRevisionId").textValue());
        assertEquals(status.activePayloadSha256(), document.path("activePayloadSha256").textValue());
        assertEquals(status.health(), MAPPER.convertValue(document.path("health"), List.class));
        assertTrue(Files.size(published) <= BordeauxRobotStatusPublisher.MAX_STATUS_BYTES);
    }

    @Test
    void rejectsSymlinkAndNonDirectoryNamespacesBeforeWriting() throws IOException {
        Path ordinaryFile = Files.writeString(temporaryDirectory.resolve("not-a-directory"), "no");
        BordeauxRuntimeException fileFailure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRobotStatusPublisher(ordinaryFile));
        assertTrue(fileFailure.getMessage().contains("directory"), fileFailure::getMessage);

        Path target = Files.createDirectory(temporaryDirectory.resolve("target"));
        Path link = temporaryDirectory.resolve("namespace-link");
        try {
            Files.createSymbolicLink(link, target);
        } catch (UnsupportedOperationException exception) {
            return;
        }
        BordeauxRuntimeException linkFailure = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRobotStatusPublisher(link));
        assertTrue(linkFailure.getMessage().contains("symbolic link"), linkFailure::getMessage);
        assertTrue(Files.notExists(target.resolve("status.json")));
    }

    @Test
    void refusesToReplaceAnExistingSymlinkStatusFile() throws IOException {
        Path namespace = Files.createDirectory(temporaryDirectory.resolve("push-v1"));
        Path outside = Files.writeString(temporaryDirectory.resolve("outside-status.json"), "original");
        try {
            Files.createSymbolicLink(namespace.resolve("status.json"), outside);
        } catch (UnsupportedOperationException exception) {
            return;
        }

        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRobotStatusPublisher(namespace).publish(status()));

        assertTrue(exception.getMessage().contains("symbolic link"), exception::getMessage);
        assertEquals("original", Files.readString(outside));
    }

    private static BordeauxRuntimeStatus status() {
        return new BordeauxRuntimeStatus(
                "00000000-0000-0000-0000-000000000001", 9604, true, "test-robot", HASH, "0.1.0",
                "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0", HASH, HASH,
                List.of("ready: active revision " + HASH));
    }
}
