      if (startCurvature !== undefined) dd0 = accelerationAtCurvature(d0, dd0, startCurvature);
      const endCurvature = smoothJointCurvature.get(i + 1);
      if (endCurvature !== undefined) dd1 = accelerationAtCurvature(d1, dd1, endCurvature);
      smoothBezier = quinticHermite(p0, d0, dd0, p1, d1, dd1);
    }
    for (let k = 0; k <= steps; k++) {
      if (i > 0 && k === 0) continue; // avoid dup at seg joints
      const t = k / steps;
      let pos, head, curv;
      if (effType === 'line') {
        pos = { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) };
        head = Math.atan2(p1.y - p0.y, p1.x - p0.x); curv = 0;
      } else if (effType === 'arc' && arc) {
        const ang = arc.a0 + arc.sweep * t;
        pos = { x: arc.Cx + arc.rad * Math.cos(ang), y: arc.Cy + arc.rad * Math.sin(ang) };
        head = ang + (arc.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2);
        curv = arc.rad > 1e-6 ? 1 / arc.rad : 0;
      } else if (effType === 'clothoid' && cloth) {
        // Numerical integration may drift; authored segment endpoints remain exact.
        pos = k === steps ? p1 : { x: cloth.xs[k], y: cloth.ys[k] }; head = cloth.hs[k]; curv = Math.abs(cloth.ks[k]);
      } else {
        const smooth = smoothBezier ? evalQuintic(smoothBezier, t) : null;
        pos = smooth ? smooth.pos : bez(p0, c0, c1, p1, t);
        const d = smooth ? smooth.derivative : bezD(p0, c0, c1, p1, t);
        const dd = smooth ? smooth.secondDerivative : bezDD(p0, c0, c1, p1, t);
        const speed2 = d.x * d.x + d.y * d.y, cross = d.x * dd.y - d.y * dd.x;
        head = Math.atan2(d.y, d.x); curv = speed2 > 1e-9 ? Math.abs(cross) / Math.pow(speed2, 1.5) : 0;
      }
      pts.push({ x: pos.x, y: pos.y, seg: i, t, heading: head, curv, s: 0 });
    }
    wpIdx.push(pts.length - 1);
  }

  // Blend curvature across adjacent clothoid joints. Position/heading already use a shared
  // tangent; this removes artificial velocity dips from independent curvature estimates.
  for (let j = 1; j < segs; j++) {
    if (!clothoidSegments.has(j - 1) || !clothoidSegments.has(j)) continue;
    const center = trackWaypointIndices ? wpIdx[j] : pts.findIndex((p) => p.seg === j - 1 && p.t > 1 - 1e-9);
    if (center < 0) continue;
    const next = Math.min(pts.length - 1, center + 1);
    const jointK = 0.5 * ((pts[center].curv || 0) + (pts[next].curv || 0));
    const span = Math.max(2, Math.round(steps * 0.16));
    for (let off = -span; off <= span; off++) {
      const idx = center + off;
      if (idx < 0 || idx >= pts.length) continue;
      if (!clothoidSegments.has(pts[idx].seg)) continue;
      const u = 1 - Math.min(1, Math.abs(off) / span);
      const w = u * u * (3 - 2 * u);
      pts[idx].curv = lerp(pts[idx].curv || 0, jointK, w);
    }
  }

  // arclength
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    s += Math.hypot(dx, dy);
    pts[i].s = s;
  }
  return trackWaypointIndices ? { pts, length: s, segs, wpIdx } : { pts, length: s, segs };
}

// point + fraction lookup by arclength fraction f (for placing markers/targets)
export function pointAtFraction(f: number, pts: readonly Pick<GeometryPoint, "x" | "y" | "heading" | "s">[]) {
  const n = pts.length; if (!n) return { x: 0, y: 0, heading: 0 };
  const target = f * pts[n - 1].s;
  let lo = 1, hi = n - 1;
  if (target <= 0) return { ...pts[0] };
  if (target >= pts[n - 1].s) return { ...pts[n - 1] };
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].s < target) lo = mid + 1; else hi = mid; }
  const a = pts[lo - 1], b = pts[lo];
  const u = (target - a.s) / Math.max(1e-6, b.s - a.s);
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), heading: angLerp(a.heading, b.heading, u) };
}

// nearest fraction on path to a world point (for placing markers by click)
export function nearestFraction(wx: number, wy: number, pts: readonly Pick<GeometryPoint, "x" | "y" | "s">[]) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - wx, dy = pts[i].y - wy; const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return pts.length > 1 ? pts[best].s / pts[pts.length - 1].s : 0;
}

// auto control handles for a fresh waypoint (smooth Catmull-Rom-ish)
export function autoHandles(waypoints: readonly ControlPoint[], i: number) {
  const w = waypoints[i];
  const prev = waypoints[i - 1] || w, next = waypoints[i + 1] || w;
  let dx = next.x - prev.x, dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const handle = Math.max(0.6, len * 0.28);
  return {
    prevC: { x: w.x - dx * handle, y: w.y - dy * handle },
    nextC: { x: w.x + dx * handle, y: w.y + dy * handle },
  };
}

// Path type belongs to the SEGMENT between two waypoints. The list stays honest:
// only true geometry types live here, grouped Basic / Spline. Snapping, heading-hold,
// approach and auto-smooth are tooling/constraint behaviours and live elsewhere.
export const SEGTYPES = [
  { id: 'line', label: 'Straight', abbr: 'LIN', group: 'Basic', hint: 'Straight line \u2014 control handles ignored.' },
  { id: 'arc', label: 'Arc', abbr: 'ARC', group: 'Basic', hint: 'Constant-radius turn, tangent to the out-handle.' },
  { id: 'bezier', label: 'B\u00e9zier', abbr: 'BEZ', group: 'Spline', hint: 'Hand-shaped spline driven by the control handles.' },
  { id: 'clothoid', label: 'Clothoid', abbr: 'CLO', group: 'Spline', hint: 'Euler spiral \u2014 curvature ramps smoothly (swerve-friendly).' },
];
