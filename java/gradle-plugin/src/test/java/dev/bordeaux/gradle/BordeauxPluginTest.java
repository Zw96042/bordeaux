package dev.bordeaux.gradle;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.gradle.api.Project;
import org.gradle.testfixtures.ProjectBuilder;
import org.junit.jupiter.api.Test;

class BordeauxPluginTest {
    @Test
    void installsTheFixedCatalogTaskAndStableCatalogIdExtension() {
        Project project = ProjectBuilder.builder().withName("robot").build();
        project.getPluginManager().apply("java");
        project.getPluginManager().apply(BordeauxPlugin.class);

        BordeauxExtension extension = project.getExtensions().getByType(BordeauxExtension.class);

        assertEquals("robot", extension.getCatalogId().get());
        assertNotNull(project.getTasks().findByName("bordeauxCatalog"));
        assertEquals("bordeaux", project.getTasks().getByName("bordeauxCatalog").getGroup());
    }
}
