
    await expect(runWorkerTask(filename, { callback: () => {} }, "Test")).rejects.toMatchObject({ name: "DataCloneError" });

    expect(terminate).toHaveBeenCalledTimes(1);
    await terminate.mock.results[0].value;
  });
});
