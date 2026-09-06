      ],
    };
    let calls = 0;
    const derive = () => {
      calls += 1;
      return {
        sample: { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], length: 1 },
        prof: { totalTime: 2, t: [0, 2], v: [0.5, 0.5], head: [0, 0] },
      };
    };

    const run = AUTO.buildRun(routine, project.paths, project.robot, {}, project.plannerId, derive);
    expect(calls).toBe(1);
    expect(run).toMatchObject({ total: 4, segs: [{ nodeId: "first" }, { nodeId: "second" }] });
  });
});
