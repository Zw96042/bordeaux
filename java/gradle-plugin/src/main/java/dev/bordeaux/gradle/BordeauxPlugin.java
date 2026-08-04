package dev.bordeaux.gradle;

import java.io.File;
import java.util.List;
import javax.inject.Inject;
import org.gradle.api.GradleException;
import org.gradle.api.Plugin;
import org.gradle.api.Project;
import org.gradle.api.file.FileSystemOperations;
import org.gradle.api.provider.Provider;
import org.gradle.api.tasks.Input;
import org.gradle.api.tasks.compile.JavaCompile;
import org.gradle.process.CommandLineArgumentProvider;

/** Minimal Gradle wiring for a normal GradleRIO Java project. */
public final class BordeauxPlugin implements Plugin<Project> {
    private static final String VERSION = "0.1.0";
    private final FileSystemOperations fileSystemOperations;

    @Inject
    public BordeauxPlugin(FileSystemOperations fileSystemOperations) {
        this.fileSystemOperations = fileSystemOperations;
    }

    @Override
    public void apply(Project project) {
        BordeauxExtension extension = project.getExtensions().create("bordeaux", BordeauxExtension.class);
        extension.getCatalogId().convention(project.getName());

        project.getPluginManager().withPlugin("java", ignored -> {
            project.getDependencies().add("compileOnly", "dev.bordeaux:bordeaux-annotations:" + VERSION);
            project.getDependencies().add("annotationProcessor", "dev.bordeaux:bordeaux-processor:" + VERSION);
            project.getDependencies().add("implementation", "dev.bordeaux:bordeaux-runtime:" + VERSION);

            project.getTasks().withType(JavaCompile.class).configureEach(task ->
                    task.getOptions().getCompilerArgumentProviders().add(
                            new CatalogIdArgumentProvider(extension.getCatalogId())));

            var compileJava = project.getTasks().named("compileJava", JavaCompile.class);
            var generatedCatalog = project.getLayout().getBuildDirectory()
                    .file("classes/java/main/META-INF/bordeaux/commands.json");
            project.getTasks().register("bordeauxCatalog", task -> {
                task.setGroup("bordeaux");
                task.setDescription("Builds build/bordeaux/catalog-v1.json for the Bordeaux app");
                task.dependsOn(compileJava);
                task.getInputs().file(generatedCatalog).withPropertyName("generatedCatalog").optional();
                task.getOutputs().file(project.getLayout().getBuildDirectory().file("bordeaux/catalog-v1.json"));
                task.doLast(unused -> {
                    File source = generatedCatalog.get().getAsFile();
                    if (!source.isFile()) {
                        throw new GradleException("No Bordeaux catalog was generated. Add at least one @BordeauxCommand method.");
                    }
                    fileSystemOperations.copy(copy -> {
                        copy.from(source);
                        copy.into(project.getLayout().getBuildDirectory().dir("bordeaux"));
                        copy.rename(ignoredName -> "catalog-v1.json");
                    });
                });
            });
        });
    }

    private static final class CatalogIdArgumentProvider implements CommandLineArgumentProvider {
        private final Provider<String> catalogId;

        private CatalogIdArgumentProvider(Provider<String> catalogId) {
            this.catalogId = catalogId;
        }

        @Input
        public String getCatalogId() {
            return catalogId.get();
        }

        @Override
        public Iterable<String> asArguments() {
            String value = getCatalogId();
            if (value.isBlank()) throw new GradleException("bordeaux.catalogId must not be blank");
            return List.of("-Abordeaux.catalogId=" + value);
        }
    }
}
