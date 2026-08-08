plugins {
    `java-library`
    `maven-publish`
}

base.archivesName.set("bordeaux-annotations")

publishing {
    publications.create<MavenPublication>("mavenJava") {
        from(components["java"])
        artifactId = "bordeaux-annotations"
    }
}
