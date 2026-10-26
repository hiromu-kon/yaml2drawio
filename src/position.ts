import type { Position } from './schema.ts';

/** Where each position sits on a box, as fractions of its width and height. */
export const POSITION_POINTS: Record<Position, readonly [x: number, y: number]> = {
  n: [0.5, 0],
  nne: [0.75, 0],
  ne: [1, 0],
  ene: [1, 0.25],
  e: [1, 0.5],
  ese: [1, 0.75],
  se: [1, 1],
  sse: [0.75, 1],
  s: [0.5, 1],
  ssw: [0.25, 1],
  sw: [0, 1],
  wsw: [0, 0.75],
  w: [0, 0.5],
  wnw: [0, 0.25],
  nw: [0, 0],
  nnw: [0.25, 0],
};

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The edge a position belongs to; corners count as the top or bottom edge. */
export function sideOf(position: Position): Side {
  const [x, y] = POSITION_POINTS[position];
  if (y === 0) return 'top';
  if (y === 1) return 'bottom';
  return x === 0 ? 'left' : 'right';
}
