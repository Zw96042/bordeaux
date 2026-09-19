// Shared muted blue scale. Increasing OKLCH lightness keeps
// low, middle and high values distinct on the dark field in every metric.
const HEATMAP = [[0.55, 0.055, 250], [0.70, 0.070, 250], [0.85, 0.040, 250]] as const;

export function metricColor(_mode: string, value: number) {
  const t = Math.max(0, Math.min(1, Number.isNaN(value) ? 0 : value)) * 2;
  const index = Math.min(1, Math.floor(t));
  const before = HEATMAP[index], after = HEATMAP[index + 1];
  return `oklch(${before.map((channel, i) => (channel + (after[i] - channel) * (t - index)).toFixed(4)).join(" ")})`;
}

export function metricGradient(mode: string) {
  return 'linear-gradient(90deg in oklch,' + [0, 0.5, 1].map(t => `${metricColor(mode, t)} ${t * 100}%`).join(',') + ')';
}

export const METRICS = [
  { id: 'velocity', label: 'Velocity', unit: 'm/s', kind: 'seq' },
  { id: 'accel', label: 'Acceleration', unit: 'm/s\u00b2', kind: 'div' },
  { id: 'angvel', label: 'Angular velocity', unit: '\u00b0/s', kind: 'div' },
  { id: 'curvature', label: 'Curvature', unit: '1/m', kind: 'seq' },
];
