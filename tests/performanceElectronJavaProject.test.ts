    const read = vi.spyOn(fs, "readFile");
    await expect(discoverJavaProject(root)).rejects.toThrow(/source exceeds.*scan limit/);
    expect(read.mock.calls.some(([name]) => String(name).endsWith("Source24.java"))).toBe(false);
  });

  it("propagates failed reads and permits a fresh scan after the file is repaired", async () => {
    const root = await project({ "Factory.java": "public class Factory { public Command run() {} }" });
    const originalRead = fs.readFile.bind(fs);
    const read = vi.spyOn(fs, "readFile").mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).endsWith("Factory.java")) throw new Error("source read failed");
      return originalRead(...args);
    }) as typeof fs.readFile);
    await expect(discoverJavaProject(root)).rejects.toThrow("source read failed");
    read.mockRestore();
    expect((await discoverJavaProject(root)).commands).toHaveLength(1);
  });
});
