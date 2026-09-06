        { anchor: "dist", f: 0.8, d: 8, name: "distance" },
      ],
      ranges: [
        { anchor: "param", f0: 0.1, f1: 0.35 },
        { anchor: "dist", f0: 0.2, f1: 0.6, d0: 2, d1: 6 },
        { anchor: "wp", f0: 0.2, f1: 0.6, w0: 0, t0: 0.2, w1: 1, t1: 0.4 },
      ],
    };

    pathMath().reversePathAnchors(path, 10);

    expect(path.targets).toEqual([
      { anchor: "param", f: 0.8, deg: 35 },
      { anchor: "dist", f: 0.7, d: 7, deg: 90 },
    ]);
    expect(path.markers).toEqual([
      { f: 0.25, name: "param default" },
      { anchor: "dist", f: 0.2, d: 2, name: "distance" },
    ]);
    expect(path.ranges[0]).toMatchObject({ anchor: "param", f0: 0.65, f1: 0.9 });
    expect(path.ranges[1]).toMatchObject({ anchor: "dist", f0: 0.4, f1: 0.8, d0: 4, d1: 8 });
    expect(path.ranges[2]).toMatchObject({ anchor: "wp", w0: 0, t0: 0.2, w1: 1, t1: 0.4 });
  });

  it("round-trips every non-waypoint anchor without semantic drift", () => {
    const path: PathFeatures = {
      targets: [{ anchor: "dist", f: 0.123, d: 1.23, deg: -45 }],
      markers: [{ anchor: "param", f: 0.876, name: "shoot" }],
      ranges: [{ anchor: "dist", f0: 0.25, f1: 0.75, d0: 2.5, d1: 7.5 }],
    };
    const before = structuredClone(path);

    pathMath().reversePathAnchors(path, 10);
    pathMath().reversePathAnchors(path, 10);

    expect(path.targets[0]).toMatchObject({ anchor: before.targets[0].anchor, deg: before.targets[0].deg });
    expect(path.targets[0].f).toBeCloseTo(before.targets[0].f, 12);
    expect(path.targets[0].d).toBeCloseTo(before.targets[0].d!, 12);
    expect(path.markers).toEqual(before.markers);
    expect(path.ranges[0].f0).toBeCloseTo(before.ranges[0].f0, 12);
    expect(path.ranges[0].f1).toBeCloseTo(before.ranges[0].f1, 12);
    expect(path.ranges[0].d0).toBeCloseTo(before.ranges[0].d0!, 12);
    expect(path.ranges[0].d1).toBeCloseTo(before.ranges[0].d1!, 12);
  });
});
