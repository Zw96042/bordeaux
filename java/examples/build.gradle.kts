dependencies {
    implementation(project(":runtime"))
    annotationProcessor(project(":processor"))

    compileOnly("edu.wpi.first.wpimath:wpimath-java:2026.2.2")
    compileOnly("edu.wpi.first.wpilibj:wpilibj-java:2026.2.2")
    compileOnly("edu.wpi.first.wpilibNewCommands:wpilibNewCommands-java:2026.2.2")
    compileOnly("edu.wpi.first.wpiunits:wpiunits-java:2026.2.2")
    compileOnly("edu.wpi.first.wpiutil:wpiutil-java:2026.2.2")

    testImplementation("edu.wpi.first.wpimath:wpimath-java:2026.2.2")
    testImplementation("edu.wpi.first.wpilibj:wpilibj-java:2026.2.2")
    testImplementation("edu.wpi.first.wpilibNewCommands:wpilibNewCommands-java:2026.2.2")
    testImplementation("edu.wpi.first.wpiunits:wpiunits-java:2026.2.2")
    testImplementation("edu.wpi.first.wpiutil:wpiutil-java:2026.2.2")
    testImplementation("us.hebi.quickbuf:quickbuf-runtime:1.4")
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("-Abordeaux.catalogId=bordeaux-example-gallery")
}
