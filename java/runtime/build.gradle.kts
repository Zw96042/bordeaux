dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.18.3")
    compileOnly(project(":annotations"))
    compileOnly("edu.wpi.first.wpilibNewCommands:wpilibNewCommands-java:2026.2.2")
    compileOnly("edu.wpi.first.wpiutil:wpiutil-java:2026.2.2")

    testImplementation("edu.wpi.first.wpilibNewCommands:wpilibNewCommands-java:2026.2.2")
    testImplementation("edu.wpi.first.wpiutil:wpiutil-java:2026.2.2")
}

tasks.jar {
    from(project(":annotations").extensions.getByType<SourceSetContainer>().named("main").map { it.output })
}
