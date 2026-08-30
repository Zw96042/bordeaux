const FULL_TURN = Math.PI * 2;

export function wrapRadians(value: number): number {
  const wrapped = value % FULL_TURN;
  if (wrapped > Math.PI) return wrapped - FULL_TURN;
  if (wrapped < -Math.PI) return wrapped + FULL_TURN;
  return wrapped;
}
