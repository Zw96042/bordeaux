plugins {
    `java-library`
    `maven-publish`
}

base.archivesName.set("bordeaux-runtime")

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.18.3")
    api(project(":annotations"))
    compileOnly("edu.wpi.first.wpilibNewCommands:wpilibNewCommands-java:2026.2.2")
    compileOnly("edu.wpi.first.wpiutil:wpiutil-java:2026.2.2")

    testImplementation("edu.wpi.first.wpilibNewCommands:wpilibNewCommands-java:2026.2.2")
    testImplementation("edu.wpi.first.wpiutil:wpiutil-java:2026.2.2")
}

tasks.jar {
    from(project(":annotations").extensions.getByType<SourceSetContainer>().named("main").map { it.output })
}

publishing {
    publications.create<MavenPublication>("mavenJava") {
        from(components["java"])
        artifactId = "bordeaux-runtime"
    }
}
