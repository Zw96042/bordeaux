plugins {
    base
}

allprojects {
    group = "dev.bordeaux"
    version = "0.1.0"

    repositories {
        mavenCentral()
        maven("https://frcmaven.wpi.edu/artifactory/release")
    }
}

subprojects {
    apply(plugin = "java-library")

    extensions.configure<JavaPluginExtension> {
        toolchain.languageVersion.set(JavaLanguageVersion.of(17))
        withSourcesJar()
    }

    tasks.withType<JavaCompile>().configureEach {
        options.release.set(17)
        options.encoding = "UTF-8"
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
