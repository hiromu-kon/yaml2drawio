import type { Shape } from './catalog.ts';
import type { DiagramNode, Direction, GroupNode, LeafNode, StackNode } from './model.ts';
import { POSITION_POINTS, sideOf } from './position.ts';
import { LINE_HEIGHT, labelSize, textWidth } from './text.ts';

export const ICON_SIZE = 48;
export const LABEL_GAP = 4;
const LEAF_PADDING_X = 16;
const LEAF_PADDING_BOTTOM = 8;
const GROUP_HEADER = 40;
export const GROUP_PADDING = 24;
const GROUP_ICON_AREA = 32;
const BORDER_GAP = 8;
const SIDE_LABEL_GAP = 8;
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
        case 'right': {
          // The label sits outside the group, beside the icon, so only half the icon intrudes
          const label = labelSize(node.label).width;
          reach.x.push(ICON_SIZE / 2 + (label > 0 ? SIDE_LABEL_GAP + label : 0));
          intrude.x.push(ICON_SIZE / 2);
          break;
        }
      }
    }
    const frame: Frame = {
      outside: { top: max(reach.top), bottom: max(reach.bottom), x: max(reach.x) },
      padding: {
        top: Math.max(GROUP_HEADER, max(intrude.top) + BORDER_GAP),
        bottom: Math.max(GROUP_PADDING, max(intrude.bottom) + BORDER_GAP),
        x: Math.max(
          GROUP_PADDING,
          max(intrude.x) + BORDER_GAP,
          group.clearLabel ? labelEndOf(group) + BORDER_GAP - contentInset(group) : 0,
        ),
      },
    };
    frames.set(group, frame);
    return frame;
  };

  // How far right of a node's left edge its leftmost icon can start. Children of a vertical stack
  // are taken as flush left, which can only overestimate the padding clear_label needs.
  const iconInset = (node: DiagramNode): number => {
    if (node.kind === 'leaf') return (measure(node).width - ICON_SIZE) / 2;
    const inner = contentInset(node);
    if (node.kind === 'stack') return inner;
    const { outside, padding } = frameOf(node);
    return outside.x + padding.x + inner;
  };
  const contentInset = (node: GroupNode | StackNode): number => {
    const [first] = node.children;
    if (!first) return 0;
    return node.direction === 'horizontal'
      ? iconInset(first)
      : Math.min(...node.children.map(iconInset));
  };

  const measure = (node: DiagramNode): Size => {
    const cached = sizes.get(node);
    if (cached) return cached;
    let size: Size;
    if (node.kind === 'leaf') {
      const label = labelSize(node.label);
      size = {
        width: columnWidths.get(node) ?? leafWidth(node),
        height: ICON_SIZE + (label.height > 0 ? LABEL_GAP + label.height : 0) + LEAF_PADDING_BOTTOM,
      };
    } else if (node.kind === 'group') {
      // An empty box (an unused subnet) is as tall as one holding an icon, so it lines up with its
      // neighbors in the other AZs
      const content =
        node.children.length > 0
          ? measureChildren(node.direction, node.children.map(measure))
          : { width: 0, height: ICON_SIZE + LABEL_GAP + LINE_HEIGHT + LEAF_PADDING_BOTTOM };
      const { outside, padding } = frameOf(node);
      const labelEnd = labelEndOf(node);
      const width = Math.max(
        content.width + padding.x * 2,
        labelEnd + GROUP_PADDING,
        widthToClearLabel(node, labelEnd),
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
      cells.set(node, iconAt(node.shape, box.x + box.width / 2, box.y + ICON_SIZE / 2));
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
    const drawn = roundRect(visible);
    cells.set(node, drawn);
    placeChildren(node, {
      x: visible.x + padding.x,
      y: visible.y + padding.top,
      width: visible.width - padding.x * 2,
      height: visible.height - padding.top - padding.bottom,
    });
    for (const { position, node: child } of node.border) {
      const [px, py] = POSITION_POINTS[position];
      cells.set(
        child,
        iconAt(child.shape, drawn.x + px * drawn.width, drawn.y + py * drawn.height),
      );
    }
  };

  const placeChildren = (node: GroupNode | StackNode, content: Rect): void => {
    const horizontal = node.direction === 'horizontal';
    const childSizes = node.children.map(measure);
    const total = measureChildren(node.direction, childSizes);
    const mainSpace = horizontal ? content.width : content.height;
    const crossSpace = horizontal ? content.height : content.width;
    let main = (mainSpace - (horizontal ? total.width : total.height)) / 2;

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

  const columnWidths = alignColumns(root);
  const size = measure(root);
  place(root, { x: 0, y: 0, ...size });
  return { cells, ...size };
}

/**
 * The icon scaled to fit the square every leaf reserves, keeping its proportions. Stretching a wide
 * shape such as a router to a square would distort it, and lines would meet empty space.
 */
export function iconSize({ width, height }: Pick<Shape, 'width' | 'height'>): Size {
  const scale = ICON_SIZE / Math.max(width, height);
  return { width: even(width * scale), height: even(height * scale) };
}

// Boxes are placed with fractions so that rounding at each level cannot shift one of two stacked
// icons by a pixel; only the center is rounded, and even sizes keep it on a whole pixel
function iconAt(shape: Pick<Shape, 'width' | 'height'>, centerX: number, centerY: number): Rect {
  const icon = iconSize(shape);
  return {
    x: Math.round(centerX) - icon.width / 2,
    y: Math.round(centerY) - icon.height / 2,
    ...icon,
  };
}

function roundRect({ x, y, width, height }: Rect): Rect {
  const left = Math.round(x);
  const top = Math.round(y);
  return {
    x: left,
    y: top,
    width: Math.round(x + width) - left,
    height: Math.round(y + height) - top,
  };
}

function even(value: number): number {
  return 2 * Math.round(value / 2);
}

/**
 * How far the label of a short icon drops below the icon, so that it starts at the bottom of the
 * square like the labels next to it. The icon itself stays centered so that lines between the
 * middles of neighbors stay straight.
 */
export function labelDrop(shape: Pick<Shape, 'width' | 'height'>): number {
  return (ICON_SIZE - iconSize(shape).height) / 2;
}

/** How far below an icon its label ends, which is where a line leaving its bottom starts. */
export function labelBelow(leaf: LeafNode): number {
  if (leaf.label === '') return 0;
  return labelDrop(leaf.shape) + leaf.label.split('\n').length * LINE_HEIGHT + 4;
}

// The group label sits at the top left, so a border child on the top edge needs the group to be
// wide enough to start right of it. A child in the top-left corner cannot clear it and is ignored.
function widthToClearLabel(group: GroupNode, labelEnd: number): number {
  const widths = group.border
    .filter(({ position }) => sideOf(position) === 'top')
    .map(({ position }) => POSITION_POINTS[position][0])
    .filter((px) => px > 0)
    .map((px) => Math.ceil((labelEnd + BORDER_GAP + ICON_SIZE / 2) / px));
  return Math.max(0, ...widths);
}

function labelEndOf(group: GroupNode): number {
  return GROUP_ICON_AREA + textWidth(group.label);
}

function leafWidth(leaf: LeafNode): number {
  return Math.max(ICON_SIZE, labelSize(leaf.label).width) + LEAF_PADDING_X * 2;
}

/**
 * Rows of leaves stacked in one column (such as an app subnet above a data subnet) get the same
 * width per column. Otherwise labels of different lengths shift the icons by a few pixels and a
 * line from one row to the next needs a small jog.
 */
function alignColumns(root: DiagramNode): Map<LeafNode, number> {
  const widths = new Map<LeafNode, number>();
  const visit = (node: DiagramNode): void => {
    if (node.kind === 'leaf') return;
    if (node.direction === 'vertical') {
      const rows = node.children.flatMap((child) => {
        const row = leafRow(child);
        return row ? [row] : [];
      });
      for (const count of new Set(rows.map((row) => row.length))) {
        const sameCount = rows.filter((row) => row.length === count);
        if (sameCount.length < 2) continue;
        for (let column = 0; column < count; column++) {
          const leaves = sameCount.flatMap((row) => row[column] ?? []);
          const width = Math.max(...leaves.map(leafWidth));
          for (const leaf of leaves) widths.set(leaf, width);
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return widths;
}

function leafRow(node: DiagramNode): LeafNode[] | undefined {
  if (node.kind === 'leaf' || node.direction !== 'horizontal') return undefined;
  const leaves = node.children.filter((child) => child.kind === 'leaf');
  return leaves.length === node.children.length ? leaves : undefined;
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
  if (align === 'center') return (space - size) / 2;
  return 0;
}
