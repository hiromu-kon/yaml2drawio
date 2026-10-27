import { LABEL_GAP, type Layout, type Rect } from './layout.ts';
import type { Problem } from './load.ts';
import type { Diagram, DiagramNode, Direction, Endpoint, Link } from './model.ts';
import { sideOf, type Side } from './position.ts';
import { anchor, bendPoints, routeContext, type Point, type RouteContext } from './route.ts';
import { labelSize } from './text.ts';

// draw.io draws a group's icon in a 25px square at its top left, with the label beside it
const GROUP_ICON = 25;
// How far draw.io runs a line out of a side before turning back, when both ends face the same way
const JETTY = 20;
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

/**
 * Links whose lines run over an icon or a label. draw.io routes the parts of a line between its
 * bend points, so the path is predicted the way draw.io usually draws it.
 */
export function findCrossings(diagram: Diagram, layout: Layout): CrossingReport {
  const obstacles = obstaclesOf(diagram.root, layout);
  const context = routeContext(diagram.root, layout);
  const report: CrossingReport = { crossings: [], unchecked: [] };
  for (const link of diagram.links) {
    const path = predictPath(link, context);
    if (!path) {
      report.unchecked.push(link);
      continue;
    }
    const segments = path.slice(1).map((end, index) => [path[index] ?? end, end] as const);
    for (const { owner, name, rect } of obstacles) {
      if (owner === link.from.id || owner === link.to.id) continue;
      if (!segments.some(([a, b]) => crosses(a, b, rect))) continue;
      report.crossings.push({
        message: `link ${linkText(link)} crosses ${name}`,
        ...link.location,
      });
    }
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
          rect: trimEnds(leafLabelRect(rect, label, labelSide)),
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
): Rect {
  const above = { y: icon.y - label.height, width: label.width, height: label.height };
  if (side === 'left') return { x: icon.x - LABEL_GAP - label.width, ...above };
  if (side === 'right') return { x: icon.x + icon.width + LABEL_GAP, ...above };
  return {
    x: icon.x + (icon.width - label.width) / 2,
    y: icon.y + icon.height,
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

function styleValue(style: string, key: string): string | undefined {
  return style
    .split(';')
    .map((entry) => entry.split('='))
    .findLast(([name]) => name === key)?.[1];
}

function predictPath(link: Link, context: RouteContext): Point[] | undefined {
  const start = anchor(context, link.from);
  const end = anchor(context, link.to);
  if (!start || !end || !link.from.position || !link.to.position) return undefined;

  const path = [start];
  let heading = directionOf(sideOf(link.from.position));
  for (const bend of bendPoints(link, context)) {
    heading = turnTowards(path, heading, bend);
  }
  arrive(path, heading, end, sideOf(link.to.position));
  return path;
}

// Keeps going the way the line heads until it is level with the point, then turns to it
function turnTowards(path: Point[], heading: Direction, to: Point): Direction {
  const from = path.at(-1) ?? to;
  if (from.x !== to.x && from.y !== to.y) {
    path.push(heading === 'horizontal' ? { x: to.x, y: from.y } : { x: from.x, y: to.y });
  }
  path.push(to);
  const last = path.at(-2) ?? from;
  return last.y === to.y ? 'horizontal' : 'vertical';
}

// The last part has to come straight into the side of the target. A line heading across that side
// turns once; one already heading into it turns twice, halfway if the side faces it or just beyond
// the side if it faces away.
function arrive(path: Point[], heading: Direction, end: Point, side: Side): void {
  const from = path.at(-1) ?? end;
  const entry = directionOf(side);
  if (heading !== entry) {
    turnTowards(path, heading, end);
    return;
  }
  const facing =
    (side === 'top' && from.y < end.y) ||
    (side === 'bottom' && from.y > end.y) ||
    (side === 'left' && from.x < end.x) ||
    (side === 'right' && from.x > end.x);
  if (facing && (entry === 'vertical' ? from.x === end.x : from.y === end.y)) {
    path.push(end);
  } else if (entry === 'vertical') {
    const y = facing
      ? (from.y + end.y) / 2
      : side === 'top'
        ? Math.min(from.y, end.y) - JETTY
        : Math.max(from.y, end.y) + JETTY;
    path.push({ x: from.x, y }, { x: end.x, y }, end);
  } else {
    const x = facing
      ? (from.x + end.x) / 2
      : side === 'left'
        ? Math.min(from.x, end.x) - JETTY
        : Math.max(from.x, end.x) + JETTY;
    path.push({ x, y: from.y }, { x, y: end.y }, end);
  }
}

function directionOf(side: Side): Direction {
  return side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
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
