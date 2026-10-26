import type { DiagramNode, Direction, GroupNode, LeafNode, StackNode } from './model.ts';
import { labelSize, textWidth } from './text.ts';

export const ICON_SIZE = 48;
const LABEL_GAP = 4;
const LEAF_PADDING_X = 16;
const LEAF_PADDING_BOTTOM = 8;
const GROUP_HEADER = 40;
const GROUP_PADDING = 24;
const GROUP_ICON_AREA = 32;
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

export interface Layout {
  /** Geometry of each drawn cell: the visible box of a group, the icon of a leaf. */
  cells: Map<LeafNode | GroupNode, Rect>;
  width: number;
  height: number;
}

export function layoutDiagram(root: StackNode): Layout {
  const sizes = new Map<DiagramNode, Size>();
  const cells = new Map<LeafNode | GroupNode, Rect>();

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
    } else {
      const content = measureChildren(node.direction, node.children.map(measure));
      size =
        node.kind === 'group'
          ? {
              width: Math.max(
                content.width + GROUP_PADDING * 2,
                GROUP_ICON_AREA + textWidth(node.label) + GROUP_PADDING,
              ),
              height: content.height + GROUP_HEADER + GROUP_PADDING,
            }
          : content;
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
    const content =
      node.kind === 'group'
        ? {
            x: box.x + GROUP_PADDING,
            y: box.y + GROUP_HEADER,
            width: box.width - GROUP_PADDING * 2,
            height: box.height - GROUP_HEADER - GROUP_PADDING,
          }
        : box;
    if (node.kind === 'group') cells.set(node, box);
    placeChildren(node, content);
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
