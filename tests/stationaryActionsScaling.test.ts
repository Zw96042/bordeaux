      expect(duration).toBeGreaterThanOrEqual(path.waypoints[action.waypointIndex].wait! - 1e-9);
      expect(duration).toBeLessThan(path.waypoints[action.waypointIndex].wait! + 0.05);
    }
  }
  expect(result.markers.map(({ id }) => id)).toEqual(["before", "middle", "finish"]);
  expect(result.markers[0].timeS).toBeLessThan(actions[0].startTimeS);
  expect(result.markers[1].timeS).toBeGreaterThan(actions[1].endTimeS);
  expect(result.markers[2].timeS).toBe(result.totalTimeS);
  expect(result.samples.at(-1)!.headingRad).toBeCloseTo(Math.PI, 5);

});

it.each(["profiledSpline", "optimizedTrajectory"] as const)(
  "shifts a finish marker through coincident terminal-time actions in %s",
  (plannerId) => {
    for (const terminalWait of [0, 0.3]) {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "manual";
      path.waypoints = buildWaypoints([
        { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
        { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", stop: true, wait: 0.2 },
        { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", stop: terminalWait > 0, wait: terminalWait },
      ]);
      path.markers = [{ id: "finish", f: 1, name: "Finish" }];

      const result = getPlanner(plannerId).generate({ path, robot: project.robot });

      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
      expect(result.markers[0].timeS).toBe(result.totalTimeS);
    }
  },
);

it.each(["profiledSpline", "optimizedTrajectory"] as const)(
  "keeps a coincident interior marker before its action in %s",
  (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", stop: true, wait: 0.2 },
      { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 7, y: 2, theta: 0, thetaOn: true, segType: "line" },
    ]);
    path.markers = [{ id: "middle", f: 0.5, name: "Middle" }];
    const baselinePath = structuredClone(path);
    baselinePath.waypoints[1].wait = 0;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const baseline = getPlanner(plannerId).generate({ path: baselinePath, robot: project.robot });

    expect(result.markers[0].timeS).toBe(baseline.markers[0].timeS);
    expect(result.totalTimeS).toBeGreaterThan(baseline.totalTimeS);
  },
);

const benchmark = process.env.BENCHMARK_STATIONARY_ACTIONS === "1" ? it : it.skip;

benchmark("scales across dense stationary-action paths", () => {
  const output: Record<number, { elapsedMs: number; samples: number }> = {};
  for (const waypointCount of [256, 512, 1_024, 4_096]) {
    const project = manyWaitProject(waypointCount);
    const input = { path: project.paths[0], robot: project.robot };
    const base = profiledSplinePlanner.generate(input);
    const started = performance.now();
    const result = applyStationaryActions(input.path, base, input.robot);
    output[waypointCount] = {
      elapsedMs: Number((performance.now() - started).toFixed(1)),
      samples: result.samples.length,
    };
  }
  console.log(`STATIONARY_ACTION_BENCHMARK=${JSON.stringify(output)}`);
  expect(Object.values(output).every(({ elapsedMs, samples }) => elapsedMs >= 0 && samples > 0)).toBe(true);
}, 120_000);
