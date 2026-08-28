export function gradleInvocation(wrapper, args, platform = process.platform, commandProcessor = process.env.ComSpec ?? "cmd.exe") {
  if (platform !== "win32") return { executable: wrapper, arguments: args, options: {} };
  const tokens = [wrapper, ...args];
  if (tokens.some((token) => /[&|<>^%!"\r\n]/.test(token))) {
    throw new Error("Gradle invocation contains characters that cannot be launched safely by cmd.exe");
  }
  return {
    executable: commandProcessor,
    arguments: ["/d", "/s", "/c", `"${tokens.map((token) => `"${token}"`).join(" ")}"`],
    options: { windowsHide: true, windowsVerbatimArguments: true },
  };
}
