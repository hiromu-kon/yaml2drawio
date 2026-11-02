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
    const align = axis === 'y' && common.align === 'expand' ? 'start' : common.align;
    return [{ node, target: target.node, align, axis }];
  });
  const padding = new Map<LeafNode, AlignmentPadding>();
  // Each pass recomputes enclosing sizes, so changes also reach forward references and chains.
  const limit = Math.max(128, constraints.length * 8);
  for (let pass = 0; pass <= limit; pass++) {
    const layout = place(padding);
    const pending = constraints.flatMap(({ node, target, align, axis }) => {
      const from = layout.cells.get(node);
      const to = layout.cells.get(target);
      if (!from || !to) throw alignmentError(node, 'no layout for the referenced icon');
      const delta =
        axis === 'x'
          ? to.x + to.width / 2 - from.x - from.width / 2
          : to.y + to.height / 2 - from.y - from.height / 2;
      return delta === 0 ? [] : [{ node, target, align, axis, delta }];
    });
    if (pending.length === 0) return layout;
    if (
      pass === limit ||
      ![layout.width, layout.height].every((size) => Number.isFinite(size) && size <= 1e9)
    ) {
      throw new DiagramError(
        pending.map(({ node }) => ({
          code: 'alignment-conflict',
          message: `align_with for "${node.id}" cannot be satisfied together with the other layout constraints`,
          ...node.alignLocation,
        })),
      );
    }
    for (const { node, target, align, axis, delta } of pending) {
      // A start-aligned branch can grow to the right, an end-aligned one to the left.
      // Either icon may need more room; an alignment never promises to pin its target in place.
      const moveTarget = (align === 'start' && delta < 0) || (align === 'end' && delta > 0);
      const moving = moveTarget ? target : node;
      const shift = moveTarget ? -delta : delta;
      const current = padding.get(moving) ?? { left: 0, right: 0, top: 0, bottom: 0 };
      if (axis === 'x') {
        if (shift > 0) current.left += shift;
        else current.right -= shift;
      } else {
        if (shift > 0) current.top += shift;
        else current.bottom -= shift;
      }
      padding.set(moving, current);
    }
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
