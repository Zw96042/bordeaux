  }
  return transitions;
}

function headingAnchorCount(path) {
  const waypoints = Array.isArray(path?.waypoints) ? path.waypoints : [];
  const targets = Array.isArray(path?.targets) ? path.targets : [];
  const waypointAnchors = waypoints.reduce((count, waypoint, index) => (
    count + ((index === 0 || index === waypoints.length - 1 || waypoint?.thetaOn) ? 1 : 0)
  ), 0);
  return targets.length + waypointAnchors;
}

export function directPreviewWork(path, perSegment) {
  const translationPriority = (path?.ranges || []).some((range) => range?.rotationPriority === 'translation')
    || (path?.waypoints || []).some((waypoint) => waypoint?.headingTransition?.rotationPriority === 'translation');
  // Terminal heading catch-up can reach the trajectory sample cap independently of geometry size.
  if (translationPriority) return Infinity;
  const segments = Math.max(0, (path?.waypoints?.length || 0) - 1);
  const policyScans = Math.max(1, (path?.ranges?.length || 0) + headingTransitionCount(path) + headingAnchorCount(path));
  return segments * perSegment * policyScans;
}

export const directWorkIsSafe = (work) => work <= MAX_DIRECT_POLICY_SAMPLE_WORK;
