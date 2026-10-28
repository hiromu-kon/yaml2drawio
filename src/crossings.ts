import { styleValue } from './catalog.ts';
import { LABEL_GAP, labelDrop, type Layout, type Rect } from './layout.ts';
import type { Problem } from './load.ts';
import type { Diagram, DiagramNode, Endpoint, Link } from './model.ts';
import { sideOf, type Side } from './position.ts';
import {
  linesAlong,
  predictPath,
  routeContext,
  segmentsOf,
  type Placed,
  type Point,
} from './route.ts';
import { labelSize } from './text.ts';

// draw.io draws a group's icon in a 25px square at its top left, with the label beside it
const GROUP_ICON = 25;
// Label widths are estimates (see text.ts), so a line this close to either end of a label passes
const LABEL_SLACK = 4;

interface Obstacle {
  /** The leaf whose icon or label this is; lines to and from it touch it on purpose. */
  owner: string | undefined;
  name: string;
  rect: Rect;
}

export interface CrossingReport {
  crossings: Problem[];
  /** Links with an end that has no side; draw.io picks the side, so their lines are not predicted. */
  unchecked: Link[];
}

/** Links whose predicted lines run over an icon or a label, or along another line. */
export function findCrossings(diagram: Diagram, layout: Layout): CrossingReport {
  const obstacles = obstaclesOf(diagram.root, layout);
  const context = routeContext(diagram.root, layout, diagram.links);
  const report: CrossingReport = { crossings: [], unchecked: [] };
  const drawn: Placed[] = [];
  for (const link of diagram.links) {
    const path = predictPath(link, context);
    if (!path) {
      report.unchecked.push(link);
      continue;
    }
    const segments = segmentsOf(path);
    for (const { owner, name, rect } of obstacles) {
      if (owner === link.from.id || owner === link.to.id) continue;
      if (!segments.some(([a, b]) => crosses(a, b, rect))) continue;
      report.crossings.push({
        message: `link ${linkText(link)} crosses ${name}`,
        ...link.location,
      });
    }
    for (const other of linesAlong(link, segments, drawn)) {
      report.crossings.push({
        message: `link ${linkText(link)} runs along link ${linkText(other)}`,
        ...link.location,
      });
    }
    drawn.push({ link, segments });
  }
  return report;
}

export function linkText(link: Link): string {
  return `${endpointText(link.from)} -> ${endpointText(link.to)}`;
}

function obstaclesOf(root: DiagramNode, layout: Layout): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const visit = (node: DiagramNode, labelSide?: Side): void => {
    if (node.kind === 'stack') {
      for (const child of node.children) visit(child);
      return;
    }
    const rect = layout.cells.get(node);
    if (!rect) return;
    const label = labelSize(node.label);
    if (node.kind === 'leaf') {
      obstacles.push({ owner: node.id, name: `the icon of "${node.id}"`, rect });
      if (label.width > 0) {
        obstacles.push({
          owner: node.id,
          name: `the label of "${node.id}"`,
          rect: trimEnds(leafLabelRect(rect, label, labelSide, labelDrop(node.shape))),
        });
      }
      return;
    }
    if (label.width > 0) {
      obstacles.push({
        owner: undefined,
        name: `the label of "${node.label.replaceAll('\n', ' ')}"`,
        rect: trimEnds(groupLabelRect(rect, label, node.shape.style)),
      });
    }
    for (const child of node.children) visit(child);
    for (const { node: child, position } of node.border) visit(child, sideOf(position));
  };
  visit(root);
  return obstacles;
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

function trimEnds(rect: Rect): Rect {
  return { ...rect, x: rect.x + LABEL_SLACK, width: rect.width - LABEL_SLACK * 2 };
}

// Touching an edge is not a crossing, so a line along the side of an icon passes
function crosses(a: Point, b: Point, rect: Rect): boolean {
  return (
    Math.max(a.x, b.x) > rect.x &&
    Math.min(a.x, b.x) < rect.x + rect.width &&
    Math.max(a.y, b.y) > rect.y &&
    Math.min(a.y, b.y) < rect.y + rect.height
  );
}

function endpointText({ id, position }: Endpoint): string {
  return position ? `${id}.${position}` : id;
}
