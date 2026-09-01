    const first = Math.max(0, lowerBound(fractions, start - EPSILON) - 1);
    const last = Math.min(count - 1, upperBound(fractions, end + EPSILON) - 1);
    return first <= last ? { ...policy, first, last } : null;
  };
  const indexedRanges = ranges.map(toIndexed).filter((policy): policy is IndexedPolicy => policy != null)
    .sort((a, b) => a.first - b.first);
  const indexedTransitions = transitions.map(toIndexed).filter((policy): policy is IndexedPolicy => policy != null);
  const active = new Int32Array(count + 1);
  const heading = new Int32Array(count + 1);
  const transition = new Int32Array(count + 1);
  const headingTransition = new Int32Array(count + 1);
  const addPolicy = (policy: IndexedPolicy, isTransition: boolean) => {
    active[policy.first] += 1;
    active[policy.last + 1] -= 1;
    if (policy.rotationPriority !== "translation") {
      heading[policy.first] += 1;
      heading[policy.last + 1] -= 1;
    }
    if (isTransition) {
      transition[policy.first] += 1;
      transition[policy.last + 1] -= 1;
      if (policy.rotationPriority !== "translation") {
        headingTransition[policy.first] += 1;
        headingTransition[policy.last + 1] -= 1;
      }
    }
  };
  indexedRanges.forEach((policy) => addPolicy(policy, false));
  indexedTransitions.forEach((policy) => addPolicy(policy, true));

  const translationPriority = new Array<boolean>(count + 1).fill(false);
  const activeTranslationPriority = new Array<boolean>(count + 1).fill(false);
  let activeCount = 0;
  let headingCount = 0;
  let transitionCount = 0;
  let headingTransitionCount = 0;
  let transitionFollowing = false;
  for (let interval = 0; interval < count; interval += 1) {
    activeCount += active[interval];
    headingCount += heading[interval];
    transitionCount += transition[interval];
    headingTransitionCount += headingTransition[interval];
    if (transitionCount > 0) transitionFollowing = headingTransitionCount === 0;
    activeTranslationPriority[interval + 1] = activeCount > 0 && headingCount === 0;
    translationPriority[interval + 1] = activeCount > 0 ? activeTranslationPriority[interval + 1] : transitionFollowing;
  }

  return {
    maxVel: minimums(indexedRanges, count, "maxVel", 1),
    maxAccel: minimums(indexedRanges, count, "maxAccel", 1),
    maxDecel: minimums(indexedRanges, count, "maxDecel", 1),
    maxAngVel: minimums(indexedRanges, count, "maxAngVel", 1),
    maxAngAccel: minimums(indexedRanges, count, "maxAngAccel", 1),
    activeTranslationPriority,
    translationPriority,
  };
}

/** Indexes the range limits active at each exact sample fraction. */
export function indexPointPolicies(fractions: readonly number[], ranges: readonly IntervalPolicy[]) {
  const indexedRanges = ranges.map((policy): IndexedPolicy | null => {
    const start = Math.min(policy.start, policy.end);
    const end = Math.max(policy.start, policy.end);
    const first = lowerBound(fractions, start - EPSILON);
    const last = upperBound(fractions, end + EPSILON) - 1;
    return first <= last ? { ...policy, first, last } : null;
  }).filter((policy): policy is IndexedPolicy => policy != null).sort((a, b) => a.first - b.first);
  return {
    maxVel: minimums(indexedRanges, fractions.length, "maxVel", 0),
    maxAccel: minimums(indexedRanges, fractions.length, "maxAccel", 0),
    maxDecel: minimums(indexedRanges, fractions.length, "maxDecel", 0),
  };
}
