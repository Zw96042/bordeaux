plugins {
    base
}

val bordeauxVersion = providers.gradleProperty("bordeauxVersion").get()
val bordeauxFrcYear = providers.gradleProperty("bordeauxFrcYear").get()
val vendorFileName = "BordeauxLib${bordeauxFrcYear}.json"
val publicRepository = "https://raw.githubusercontent.com/Zw96042/bordeaux/java-maven"

allprojects {
    group = "dev.bordeaux"
    version = bordeauxVersion

    repositories {
        mavenCentral()
        maven("https://frcmaven.wpi.edu/artifactory/release")
    }
}

subprojects {
    apply(plugin = "java-library")
    apply(plugin = "maven-publish")

    extensions.configure<JavaPluginExtension> {
        toolchain.languageVersion.set(JavaLanguageVersion.of(17))
        withSourcesJar()
    }

    extensions.configure<PublishingExtension> {
        publications.create<MavenPublication>("mavenJava") {
            from(components["java"])
            artifactId = if (project.name == "vendor") "bordeaux-java" else "bordeaux-${project.name}"
            pom {
                name.set("Bordeaux ${project.name}")
                description.set("Robot-side Java support for Bordeaux FRC trajectory authoring.")
                url.set("https://github.com/Zw96042/bordeaux")
                licenses {
                    license {
                        name.set("Apache License, Version 2.0")
                        url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
                        distribution.set("repo")
                    }
                }
                developers {
                    developer {
                        id.set("frc2468")
                        name.set("FRC Team 2468")
                    }
                }
                scm {
                    connection.set("scm:git:https://github.com/Zw96042/bordeaux.git")
                    developerConnection.set("scm:git:ssh://git@github.com/Zw96042/bordeaux.git")
                    url.set("https://github.com/Zw96042/bordeaux")
                }
            }
        }
        repositories.maven {
            name = "releaseBundle"
            url = rootProject.layout.buildDirectory.dir("release/maven").get().asFile.toURI()
        }
    }

    tasks.withType<JavaCompile>().configureEach {
        options.release.set(17)
        options.encoding = "UTF-8"
    }

    tasks.withType<Jar>().configureEach {
        archiveBaseName.set(if (project.name == "vendor") "bordeaux-java" else "bordeaux-${project.name}")
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
    }

    dependencies {
        "testImplementation"(platform("org.junit:junit-bom:5.11.4"))
        "testImplementation"("org.junit.jupiter:junit-jupiter")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }
}

val generateVendordep by tasks.registering(Copy::class) {
    inputs.property("version", bordeauxVersion)
    inputs.property("frcYear", bordeauxFrcYear)
    from(layout.projectDirectory.file("BordeauxLib2026.json")) {
        expand(
            "bordeauxVersion" to bordeauxVersion,
            "bordeauxFrcYear" to bordeauxFrcYear,
            "vendorFileName" to vendorFileName,
            "publicRepository" to publicRepository,
        )
    }
    into(layout.buildDirectory.dir("release"))
}

val copyJavaReleaseArtifacts by tasks.registering(Copy::class) {
    val annotationsJar = project(":annotations").tasks.named<Jar>("jar")
    val processorJar = project(":processor").tasks.named<Jar>("jar")
    val runtimeJar = project(":runtime").tasks.named<Jar>("jar")
    val vendorJar = project(":vendor").tasks.named<Jar>("jar")
    dependsOn(annotationsJar, processorJar, runtimeJar, vendorJar)
    from(annotationsJar, processorJar, runtimeJar, vendorJar)
    into(layout.buildDirectory.dir("release/artifacts"))
}

val javaReleaseBundle by tasks.registering {
    dependsOn(
        generateVendordep,
        copyJavaReleaseArtifacts,
        subprojects.map { it.tasks.named("publishMavenJavaPublicationToReleaseBundleRepository") },
    )
}

val javaSupportDist by tasks.registering(Sync::class) {
    val runtimeJar = project(":runtime").tasks.named<Jar>("jar")
    val processorJar = project(":processor").tasks.named<Jar>("jar")
    dependsOn(runtimeJar, processorJar)
    from(runtimeJar) { rename { "bordeaux-runtime.jar" } }
    from(processorJar) { rename { "bordeaux-processor.jar" } }
    into(layout.projectDirectory.dir("dist"))
}

tasks.named("assemble") {
    dependsOn(javaSupportDist)
}
