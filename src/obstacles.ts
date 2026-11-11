import { styleValue } from './catalog.ts';
import { LABEL_GAP, labelDrop, type Layout, type Rect } from './layout.ts';
import type { DiagramNode } from './model.ts';
import { sideOf, type Side } from './position.ts';
import type { Point, Segment } from './route.ts';
import { labelSize } from './text.ts';

const GROUP_ICON = 25;
const LABEL_SLACK = 4;

export interface Obstacle {
  /** The leaf whose icon or label this is. */
  owner: string | undefined;
  part: 'icon' | 'label';
  name: string;
  rect: Rect;
}

export function obstaclesOf(
  root: DiagramNode,
  layout: Layout,
): { obstacles: Obstacle[]; groups: { id: string; name: string; rect: Rect }[] } {
  const obstacles: Obstacle[] = [];
  const groups: { id: string; name: string; rect: Rect }[] = [];
  const visit = (node: DiagramNode, labelSide?: Side): void => {
    if (node.kind === 'empty') return;
    if (node.kind === 'stack') {
      for (const child of node.children) visit(child);
      return;
    }
    const rect = layout.cells.get(node);
    if (!rect) return;
    const label = labelSize(node.label);
    if (node.kind === 'leaf') {
      obstacles.push({ owner: node.id, part: 'icon', name: `the icon of "${node.id}"`, rect });
      if (label.width > 0) {
        obstacles.push({
          owner: node.id,
          part: 'label',
          name: `the label of "${node.id}"`,
          rect: trimEnds(leafLabelRect(rect, label, labelSide, labelDrop(node.shape))),
        });
      }
      return;
    }
    const groupName = `"${(node.label || node.id).replaceAll('\n', ' ')}"`;
    groups.push({ id: node.id, name: groupName, rect });
    if (label.width > 0) {
      obstacles.push({
        owner: node.id,
        part: 'label',
        name: `the label of ${groupName}`,
        rect: trimEnds(groupLabelRect(rect, label, node.shape.style)),
      });
    }
    for (const child of node.children) visit(child);
    for (const { node: child, position } of node.border) visit(child, sideOf(position));
  };
  visit(root);
  return { obstacles, groups };
}

// Matches where drawio.ts puts labels: beside and above the icon on a group's left or right edge,
// below it everywhere else
function leafLabelRect(
  icon: Rect,
  label: { width: number; height: number },
  side: Side | undefined,
  drop: number,
): Rect {
  const above = { y: icon.y - label.height, width: label.width, height: label.height };
  if (side === 'left') return { x: icon.x - LABEL_GAP - label.width, ...above };
  if (side === 'right') return { x: icon.x + icon.width + LABEL_GAP, ...above };
  return {
    x: icon.x + (icon.width - label.width) / 2,
    y: icon.y + icon.height + drop,
    width: label.width,
    height: LABEL_GAP + label.height,
  };
}

// AWS groups with an icon put the label beside it at the top left; the others center it at the top,
// below the icon if they have one there
function groupLabelRect(
  group: Rect,
  label: { width: number; height: number },
  style: string,
): Rect {
  if (styleValue(style, 'align') === 'left') {
    return {
      x: group.x,
      y: group.y,
      width: Number(styleValue(style, 'spacingLeft') ?? 0) + label.width,
      height: Math.max(GROUP_ICON, label.height + LABEL_GAP),
    };
  }
  return {
    x: group.x + (group.width - label.width) / 2,
    y: group.y + Number(styleValue(style, 'spacingTop') ?? 0),
    width: label.width,
    height: label.height + LABEL_GAP,
  };
}

export function trimEnds(rect: Rect): Rect {
  const slack = Math.min(LABEL_SLACK, rect.width / 4);
  return { ...rect, x: rect.x + slack, width: rect.width - slack * 2 };
}

export function borderOf({ x, y, width, height }: Rect): Segment[] {
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  return corners.map((corner, index) => [corner, corners[(index + 1) % 4] ?? corner]);
}

export function overlapsRect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Touching an edge is not a crossing, so a line along the side of an icon passes
export function crosses(a: Point, b: Point, rect: Rect): boolean {
  return (
    Math.max(a.x, b.x) > rect.x &&
    Math.min(a.x, b.x) < rect.x + rect.width &&
    Math.max(a.y, b.y) > rect.y &&
    Math.min(a.y, b.y) < rect.y + rect.height
  );
}
