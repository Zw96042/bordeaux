    expect(derive).not.toHaveBeenCalled();
  });
});


describe('interactive preview transport', () => {
  it('does not clone accepted samples during pointer edits, and preserves the source identity', () => {
    const project = createDemoProject();
    let artifactReads = 0;
    const artifact = { get samples() { artifactReads += 1; return fixture().trajectory.samples; } };
    const path = { ...project.paths[0], optimization: { corridorM: 0.2, accepted: { result: artifact } } };
    const jobs: any[] = [];
    const worker = {
      onmessage: (_event: { data: any }) => {},
      postMessage(job: any) { jobs.push(structuredClone(job)); },
      terminate() {},
    };
    const preview = PathPreview.create({ workerFactory: () => worker });
    try {
      preview.request({ path, robot: project.robot, quality: 'interactive' });
      expect(artifactReads).toBe(0);
      expect(jobs[0].path.optimization).toBeUndefined();
      expect(jobs[0].path.waypoints).toEqual(path.waypoints);
      worker.onmessage({ data: { id: jobs[0].id, value: {} } });
      expect(preview.getSnapshot().path).toBe(path);
      expect(path.optimization.accepted.result).toBe(artifact);
      preview.request({ path, robot: project.robot, quality: 'final' });
      expect(artifactReads).toBe(1);
      expect(jobs[1].path.optimization.accepted.result.samples).toHaveLength(5);
    } finally {
      preview.destroy();
    }
  });
});
