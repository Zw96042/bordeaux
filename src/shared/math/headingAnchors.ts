      const c0 = headings[i];
      const c1 = headings[i + 1] - headings[i] - span * span * (2 * second[i] + second[i + 1]) / 6;
      const c2 = second[i] * span * span / 2;
      const c3 = (second[i + 1] - second[i]) * span * span / 6;
      const extrema = [];
      const discriminant = 4 * c2 * c2 - 12 * c3 * c1;
      if (Math.abs(c3) > 1e-12 && discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        extrema.push((-2 * c2 + root) / (6 * c3), (-2 * c2 - root) / (6 * c3));
      } else if (Math.abs(c2) > 1e-12) extrema.push(-c1 / (2 * c2));
      const reversesAtStart = i > 0 && Math.sign(secants[i - 1]) !== Math.sign(secants[i]);
      const reversesAtEnd = i + 1 < secants.length && Math.sign(secants[i]) !== Math.sign(secants[i + 1]);
      const localOvershoot = reversesAtStart || reversesAtEnd ? overshootLimit : 0;
      const low = Math.min(headings[i], headings[i + 1]) - localOvershoot;
      const high = Math.max(headings[i], headings[i + 1]) + localOvershoot;
      return extrema.every((t) => t <= 0 || t >= 1
        || (c0 + c1 * t + c2 * t ** 2 + c3 * t ** 3 >= low - 1e-9
          && c0 + c1 * t + c2 * t ** 2 + c3 * t ** 3 <= high + 1e-9));
    });
    if (bounded) {
      const spline = { headings, second };
      headingSplineCache.set(anchors, spline);
      return spline;
    }
  }
  const slopes = new Array<number>(anchors.length).fill(0);
  for (let i = 1; i < anchors.length - 1; i++) {
    const before = secants[i - 1], after = secants[i];
    if (Math.abs(before) <= 1e-9 || Math.abs(after) <= 1e-9 || Math.sign(before) !== Math.sign(after)) continue;
    const beforeSpan = spans[i - 1], afterSpan = spans[i];
    const firstWeight = 2 * afterSpan + beforeSpan;
    const secondWeight = afterSpan + 2 * beforeSpan;
    slopes[i] = (firstWeight + secondWeight) / (firstWeight / before + secondWeight / after);
  }
  const spline = { headings, slopes };
  headingSplineCache.set(anchors, spline);
  return spline;
}

export function headingAt(f: number, anchors: readonly HeadingAnchor[]) {
  if (!anchors.length) return 0;
  if (f <= anchors[0].f) return anchors[0].rad;
  const spline = headingSpline(anchors);
  const { headings } = spline;
  // Select the first interval ending at or after f. Using a lower bound
  // preserves the incoming interval at exact anchors, including duplicates.
  let low = 1, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].f < f) low = middle + 1;
    else high = middle;
  }
  const i = low - 1;
  if (low < anchors.length && f >= anchors[i].f && f <= anchors[low].f) {
    const a = anchors[i], b = anchors[low];
    const span = b.f - a.f;
    if (span < 1e-9) return headings[i];
    if (spline.second) {
      const left = b.f - f, right = f - a.f;
      return spline.second[i] * left ** 3 / (6 * span)
        + spline.second[i + 1] * right ** 3 / (6 * span)
        + (headings[i] - spline.second[i] * span ** 2 / 6) * left / span
        + (headings[i + 1] - spline.second[i + 1] * span ** 2 / 6) * right / span;
    }
    const t = (f - a.f) / span, slopes = spline.slopes;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * headings[i]
      + (t3 - 2 * t2 + t) * span * slopes[i]
      + (-2 * t3 + 3 * t2) * headings[i + 1]
      + (t3 - t2) * span * slopes[i + 1];
  }
  return headings[headings.length - 1];
}

// build heading anchors from a flat list of {f, rad} entries (waypoint thetas + rotation targets)
// ensures coverage of f=0 and f=1 so heading is defined across the whole path
export function buildAnchors(entries: readonly HeadingAnchor[]) {
  const arr = (entries || [])
    .filter(e => e && isFinite(e.f) && isFinite(e.rad))
    .map(e => ({ f: Math.max(0, Math.min(1, e.f)), rad: e.rad }))
    .sort((a, b) => a.f - b.f);
  if (!arr.length) return [{ f: 0, rad: 0 }, { f: 1, rad: 0 }];
  if (arr[0].f > 1e-6) arr.unshift({ f: 0, rad: arr[0].rad });
  if (arr[arr.length - 1].f < 1 - 1e-6) arr.push({ f: 1, rad: arr[arr.length - 1].rad });
  return arr;
}
