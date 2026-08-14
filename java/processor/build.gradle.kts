dependencies {
    compileOnly(project(":annotations"))

    testImplementation(project(":runtime"))
    testImplementation("edu.wpi.first.wpilibNewCommands:wpilibNewCommands-java:2026.2.2")
    testImplementation("edu.wpi.first.wpiutil:wpiutil-java:2026.2.2")
}

tasks.jar {
    from(project(":annotations").extensions.getByType<SourceSetContainer>().named("main").map { it.output })
}
