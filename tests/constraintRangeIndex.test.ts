    const ranges = Array.from({ length: 40 }, (_, index): IntervalPolicy => ({
      start: ((index * 17) % 97) / 97,
      end: ((index * 17) % 97) / 97 + (index % 3 === 0 ? 0.001 : 0.08),
      maxVel: 0.4 + index % 7,
      maxAccel: index % 5 === 0 ? 0 : 0.2 + index % 4,
      maxDecel: 0.3 + index % 6,
      maxAngVel: 45 + index,
      maxAngAccel: 90 + index * 2,
      rotationPriority: index % 4 === 0 ? "translation" : "heading",
    }));
    const transitions: IntervalPolicy[] = [
      { start: 0.11, end: 0.111, rotationPriority: "translation" },
      { start: 0.48, end: 0.52, rotationPriority: "heading" },
      { start: 0.81, end: 0.811, rotationPriority: "translation" },
    ];
    const renderer = PM;

    const shared = plain(indexIntervalPolicies(fractions, ranges, transitions));
    expect(shared).toEqual(naiveIndex(fractions, ranges, transitions));
    expect(plain(renderer.indexIntervalPolicies(fractions, ranges, transitions))).toEqual(shared);
  });
});
