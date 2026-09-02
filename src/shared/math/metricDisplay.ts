// ---- colour scales for the metric overlays ----
function hex2rgb(hx: string) { return [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)]; }

const RAMPS_M: Record<string, Array<[number, string]>> = {
  velocity:  [[0, '#3f6fd0'], [0.4, '#2fa36b'], [0.7, '#d28f37'], [1, '#cf4f4a']],
  accel:     [[0, '#3f6fd0'], [0.5, '#4d535e'], [1, '#cf4f4a']],
  angvel:    [[0, '#343d47'], [0.5, '#2f8fa6'], [1, '#5fcfe6']],
  curvature: [[0, '#39342b'], [0.5, '#a87c30'], [1, '#edbf5c']],
};

export function metricColor(mode: string, tt: number) {
  const s = RAMPS_M[mode] || RAMPS_M.velocity;
  let t = Math.max(0, Math.min(1, tt));
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      const ca = hex2rgb(a[1]), cb = hex2rgb(b[1]);
      return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * u)},${Math.round(ca[1] + (cb[1] - ca[1]) * u)},${Math.round(ca[2] + (cb[2] - ca[2]) * u)})`;
    }
  }
  return s[s.length - 1][1];
}

export function metricGradient(mode: string) {
  const s = RAMPS_M[mode] || RAMPS_M.velocity;
  return 'linear-gradient(90deg,' + s.map((x) => x[1] + ' ' + Math.round(x[0] * 100) + '%').join(',') + ')';
}

export const METRICS = [
  { id: 'velocity', label: 'Velocity', unit: 'm/s', kind: 'seq' },
  { id: 'accel', label: 'Acceleration', unit: 'm/s\u00b2', kind: 'div' },
  { id: 'angvel', label: 'Angular velocity', unit: '\u00b0/s', kind: 'div' },
  { id: 'curvature', label: 'Curvature', unit: '1/m', kind: 'seq' },
];
