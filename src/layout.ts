import type { DiagramNode, Direction, GroupNode, LeafNode, StackNode } from './model.ts';
import { POSITION_POINTS, sideOf } from './position.ts';
import { labelSize, textWidth } from './text.ts';

export const ICON_SIZE = 48;
const LABEL_GAP = 4;
const LEAF_PADDING_X = 16;
const LEAF_PADDING_BOTTOM = 8;
const GROUP_HEADER = 40;
export const GROUP_PADDING = 24;
const GROUP_ICON_AREA = 32;
const BORDER_GAP = 8;
const GAP: Record<Direction, number> = { horizontal: 48, vertical: 32 };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/**
 * How far a group's border children reach outside its box, and the padding that keeps them clear
 * of its content. Left and right share one value so the content stays centered under a child on
 * the top edge even when only one side has border children.
 */
interface Frame {
  outside: { top: number; bottom: number; x: number };
  padding: { top: number; bottom: number; x: number };
}

export interface Layout {
  /** Geometry of each drawn cell: the visible box of a group, the icon of a leaf. */
  cells: Map<LeafNode | GroupNode, Rect>;
  width: number;
  height: number;
}

export function layoutDiagram(root: StackNode): Layout {
  const sizes = new Map<DiagramNode, Size>();
  const frames = new Map<GroupNode, Frame>();
  const cells = new Map<LeafNode | GroupNode, Rect>();

  const frameOf = (group: GroupNode): Frame => {
    const cached = frames.get(group);
    if (cached) return cached;
    const reach = { top: [0], bottom: [0], x: [0] };
    const intrude = { top: [0], bottom: [0], x: [0] };
    for (const { position, node } of group.border) {
      const size = measure(node);
      const below = size.height - ICON_SIZE / 2;
      switch (sideOf(position)) {
        case 'top':
          reach.top.push(ICON_SIZE / 2);
          intrude.top.push(below);
          break;
        case 'bottom':
          reach.bottom.push(below);
          intrude.bottom.push(ICON_SIZE / 2);
          break;
        case 'left':
        case 'right':
          reach.x.push(size.width / 2);
          intrude.x.push(size.width / 2);
          break;
      }
    }
    const frame: Frame = {
      outside: { top: max(reach.top), bottom: max(reach.bottom), x: max(reach.x) },
      padding: {
        top: Math.max(GROUP_HEADER, max(intrude.top) + BORDER_GAP),
        bottom: Math.max(GROUP_PADDING, max(intrude.bottom) + BORDER_GAP),
        x: Math.max(GROUP_PADDING, max(intrude.x) + BORDER_GAP),
      },
    };
    frames.set(group, frame);
    return frame;
  };

  const measure = (node: DiagramNode): Size => {
    const cached = sizes.get(node);
    if (cached) return cached;
    let size: Size;
    if (node.kind === 'leaf') {
      const label = labelSize(node.label);
      size = {
        width: Math.max(ICON_SIZE, label.width) + LEAF_PADDING_X * 2,
        height: ICON_SIZE + (label.height > 0 ? LABEL_GAP + label.height : 0) + LEAF_PADDING_BOTTOM,
      };
    } else if (node.kind === 'group') {
      const content = measureChildren(node.direction, node.children.map(measure));
      const { outside, padding } = frameOf(node);
      const width = Math.max(
        content.width + padding.x * 2,
        GROUP_ICON_AREA + textWidth(node.label) + GROUP_PADDING,
      );
      const height = content.height + padding.top + padding.bottom;
      size = { width: width + outside.x * 2, height: height + outside.top + outside.bottom };
    } else {
      size = measureChildren(node.direction, node.children.map(measure));
    }
    sizes.set(node, size);
    return size;
  };

  const place = (node: DiagramNode, box: Rect): void => {
    if (node.kind === 'leaf') {
      cells.set(node, {
        x: box.x + Math.round((box.width - ICON_SIZE) / 2),
        y: box.y,
        width: ICON_SIZE,
        height: ICON_SIZE,
      });
      return;
    }
    if (node.kind === 'stack') {
      placeChildren(node, box);
      return;
    }
    const { outside, padding } = frameOf(node);
    const visible = {
      x: box.x + outside.x,
      y: box.y + outside.top,
      width: box.width - outside.x * 2,
      height: box.height - outside.top - outside.bottom,
    };
    cells.set(node, visible);
    placeChildren(node, {
      x: visible.x + padding.x,
      y: visible.y + padding.top,
      width: visible.width - padding.x * 2,
      height: visible.height - padding.top - padding.bottom,
    });
    for (const { position, node: child } of node.border) {
      const [px, py] = POSITION_POINTS[position];
      cells.set(child, {
        x: Math.round(visible.x + px * visible.width - ICON_SIZE / 2),
        y: Math.round(visible.y + py * visible.height - ICON_SIZE / 2),
        width: ICON_SIZE,
        height: ICON_SIZE,
      });
    }
  };

  const placeChildren = (node: GroupNode | StackNode, content: Rect): void => {
    const horizontal = node.direction === 'horizontal';
    const childSizes = node.children.map(measure);
    const total = measureChildren(node.direction, childSizes);
    const mainSpace = horizontal ? content.width : content.height;
    const crossSpace = horizontal ? content.height : content.width;
    let main = Math.round((mainSpace - (horizontal ? total.width : total.height)) / 2);

    node.children.forEach((child, index) => {
      const size = childSizes[index] ?? measure(child);
      const childMain = horizontal ? size.width : size.height;
      const childCross =
        node.align === 'expand' ? crossSpace : horizontal ? size.height : size.width;
      const cross = crossOffset(node.align, crossSpace, childCross);
      place(
        child,
        horizontal
          ? { x: content.x + main, y: content.y + cross, width: childMain, height: childCross }
          : { x: content.x + cross, y: content.y + main, width: childCross, height: childMain },
      );
      main += childMain + GAP[node.direction];
    });
  };

  const size = measure(root);
  place(root, { x: 0, y: 0, ...size });
  return { cells, ...size };
}

function max(values: number[]): number {
  return Math.ceil(Math.max(...values));
}

function measureChildren(direction: Direction, sizes: Size[]): Size {
  const gaps = Math.max(0, sizes.length - 1) * GAP[direction];
  if (direction === 'horizontal') {
    return {
      width: sizes.reduce((sum, s) => sum + s.width, 0) + gaps,
      height: Math.max(0, ...sizes.map((s) => s.height)),
    };
  }
  return {
    width: Math.max(0, ...sizes.map((s) => s.width)),
    height: sizes.reduce((sum, s) => sum + s.height, 0) + gaps,
  };
}

function crossOffset(align: StackNode['align'], space: number, size: number): number {
  if (align === 'end') return space - size;
  if (align === 'center') return Math.round((space - size) / 2);
  return 0;
}
