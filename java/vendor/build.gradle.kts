import org.gradle.api.file.DuplicatesStrategy
import org.gradle.api.tasks.SourceSetContainer

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.18.3")
}

val bundledProjects = listOf(project(":annotations"), project(":processor"), project(":runtime"))

tasks.named<Jar>("jar") {
    bundledProjects.forEach { bundled ->
        from(bundled.extensions.getByType<SourceSetContainer>().named("main").map { it.output })
    }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}

tasks.named<Jar>("sourcesJar") {
    bundledProjects.forEach { bundled ->
        from(bundled.layout.projectDirectory.dir("src/main/java"))
    }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}
