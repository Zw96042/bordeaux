plugins {
    `java-gradle-plugin`
    `maven-publish`
}

base.archivesName.set("bordeaux-gradle-plugin")

gradlePlugin {
    plugins {
        create("bordeaux") {
            id = "dev.bordeaux"
            implementationClass = "dev.bordeaux.gradle.BordeauxPlugin"
            displayName = "Bordeaux Java support"
            description = "Installs Bordeaux annotations, processor, runtime, and the bordeauxCatalog task"
        }
    }
}

dependencies {
    testImplementation(gradleTestKit())
}
