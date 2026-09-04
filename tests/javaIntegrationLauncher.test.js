import { describe, expect, it } from "vitest";
import { gradleInvocation } from "../scripts/java-integration-launcher.mjs";

describe("Java integration Gradle launcher", () => {
  it.each(["darwin", "linux"])("launches the wrapper directly on %s", (platform) => {
    expect(gradleInvocation("/Robot Projects/gradlew", ["build", "--no-daemon"], platform)).toEqual({
      executable: "/Robot Projects/gradlew", arguments: ["build", "--no-daemon"], options: {},
    });
  });

  it("uses cmd.exe and quotes the wrapper and project arguments on Windows", () => {
    expect(gradleInvocation("C:\\Robot Projects\\gradlew.bat", ["-p", "C:\\Robot Projects", ":runtime:test"], "win32", "C:\\Windows\\System32\\cmd.exe")).toEqual({
      executable: "C:\\Windows\\System32\\cmd.exe",
      arguments: ["/d", "/s", "/c", '""C:\\Robot Projects\\gradlew.bat" "-p" "C:\\Robot Projects" ":runtime:test""'],
      options: { windowsHide: true, windowsVerbatimArguments: true },
    });
  });

  it.each(["Robot&Other", "%TEMP%", 'Robot"Project', "Robot\nProject"])("rejects unsafe Windows command content: %s", (name) => {
    expect(() => gradleInvocation(`C:\\${name}\\gradlew.bat`, ["build"], "win32")).toThrow(/cannot be launched safely/);
    expect(() => gradleInvocation("C:\\Robot\\gradlew.bat", ["-p", name], "win32")).toThrow(/cannot be launched safely/);
  });
});
