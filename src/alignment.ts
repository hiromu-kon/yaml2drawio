import type { Layout } from './layout.ts';
import { DiagramError } from './load.ts';
import type { DiagramNode, LeafNode, StackNode } from './model.ts';

export interface AlignmentPadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Grow reserved slots rather than moving icons outside their groups or over their neighbors. */
export function alignDiagram(
  root: StackNode,
  place: (padding: Map<LeafNode, AlignmentPadding>) => Layout,
): Layout {
  const leaves = new Map<string, { node: LeafNode; path: DiagramNode[] }>();
  const visit = (node: DiagramNode, path: DiagramNode[]): void => {
    if (node.kind === 'empty') return;
    if (node.kind === 'leaf') {
      leaves.set(node.id, { node, path });
      return;
    }
    for (const child of node.children) visit(child, [...path, node]);
  };
  visit(root, []);
  const constraints = [...leaves.values()].flatMap(({ node, path }) => {
    if (!node.alignWith) return [];
    const target = leaves.get(node.alignWith);
    const common = path.findLast((parent) => target?.path.includes(parent));
    if (!target || !common || common.kind === 'leaf' || common.kind === 'empty') {
      throw alignmentError(
        node,
        'the icons must be in separate branches of a group, row or column',
      );
    }
    const axis = node.alignAxis ?? (common.direction === 'vertical' ? 'x' : 'y');
    if ((axis === 'x') === (common.direction === 'horizontal')) {
      throw alignmentError(
        node,
        `axis ${axis} conflicts with the ${common.direction} ordering of the two branches`,
      );
    }
    return [{ node, target: target.node, axis }];
  });
  let padding = new Map<LeafNode, AlignmentPadding>();
  const errorsIn = (layout: Layout) =>
    constraints.map(({ node, target, axis }) => {
      const from = layout.cells.get(node);
      const to = layout.cells.get(target);
      if (!from || !to) throw alignmentError(node, 'no layout for the referenced icon');
      return axis === 'x'
        ? to.x + to.width / 2 - from.x - from.width / 2
        : to.y + to.height / 2 - from.y - from.height / 2;
    });

  let layout = place(padding);
  const limit = Math.max(128, constraints.length * 32);
  for (let pass = 0; pass <= limit; pass++) {
    const errors = errorsIn(layout);
    const energy = energyOf(errors);
    if (energy === 0) return layout;
    let best:
      | { padding: Map<LeafNode, AlignmentPadding>; layout: Layout; energy: number; size: number }
      | undefined;
    if (pass < limit) {
      for (const [index, { node, target, axis }] of constraints.entries()) {
        const amount = Math.abs(errors[index] ?? 0);
        if (amount === 0) continue;
        // Test the actual response of both endpoints: nested start/end/expand alignment can
        // absorb padding entirely, so the common parent's alignment cannot choose this for us.
        for (const moving of [node, target]) {
          const current = padding.get(moving) ?? { left: 0, right: 0, top: 0, bottom: 0 };
          for (const side of axis === 'x'
            ? (['left', 'right'] as const)
            : (['top', 'bottom'] as const)) {
            for (const sign of [1, -1]) {
              const evaluate = (step: number) => {
                const value = Math.max(0, current[side] + sign * step);
                if (value === current[side]) return undefined;
                const candidate = new Map(padding);
                candidate.set(moving, { ...current, [side]: value });
                const placed = place(candidate);
                if (
                  ![placed.width, placed.height].every(
                    (size) => Number.isFinite(size) && size <= 1e9,
                  )
                )
                  return undefined;
                const nextErrors = errorsIn(placed);
                const score = energyOf(nextErrors);
                const size = placed.width + placed.height;
                if (
                  score < energy &&
                  (!best || score < best.energy || (score === best.energy && size < best.size))
                )
                  best = { padding: candidate, layout: placed, energy: score, size };
                return nextErrors[index] ?? 0;
              };
              const original = errors[index] ?? 0;
              const maximum =
                sign < 0 ? current[side] : 2 * (layout.width + layout.height + amount);
              for (let step = amount; step <= Math.max(amount, maximum); step *= 2) {
                const trial = Math.min(step, maximum);
                const error = evaluate(trial);
                if (error === undefined) break;
                if (error === 0 || error * original < 0) {
                  // Centering and rounding can absorb a small change or make a large one
                  // overshoot. Find the smallest effective change instead of accumulating slack.
                  let low = 0,
                    high = trial;
                  while (high - low > 1) {
                    const middle = Math.floor((low + high) / 2);
                    const residual = evaluate(middle);
                    if (residual === undefined || residual * original > 0) low = middle;
                    else high = middle;
                  }
                  evaluate(high);
                  break;
                }
                if (Math.abs(error) > amount || trial === maximum) break;
              }
            }
          }
        }
      }
    }
    if (!best) {
      throw new DiagramError(
        constraints.flatMap(({ node }, index) =>
          errors[index] === 0
            ? []
            : [
                {
                  code: 'alignment-conflict',
                  message: `align_with for "${node.id}" could not be resolved; check for incompatible layout constraints`,
                  ...node.alignLocation,
                },
              ],
        ),
      );
    }
    padding = best.padding;
    layout = best.layout;
  }
  throw new Error('unreachable alignment state');
}

function alignmentError(node: LeafNode, message: string): DiagramError {
  return new DiagramError([
    {
      code: 'alignment-conflict',
      message: `cannot align "${node.id}" with "${node.alignWith}": ${message}`,
      ...node.alignLocation,
    },
  ]);
}

function energyOf(errors: number[]): number {
  return errors.reduce((sum, value) => sum + value * value, 0);
}
