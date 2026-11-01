import { styleValue } from './catalog.ts';
import { LABEL_GAP, labelDrop, type Layout, type Rect } from './layout.ts';
import type { Problem } from './load.ts';
import type { Diagram, DiagramNode, Endpoint, Link } from './model.ts';
import { sideOf, type Side } from './position.ts';
import type { Position } from './schema.ts';
import {
  alongside,
  linesAlong,
  predictPath,
  routeContext,
  segmentsOf,
  type Placed,
  type Point,
  type Segment,
} from './route.ts';
import { labelSize } from './text.ts';

// draw.io draws a group's icon in a 25px square at its top left, with the label beside it
const GROUP_ICON = 25;
// Label widths are estimates (see text.ts), so a line this close to either end of a label passes
const LABEL_SLACK = 4;

interface Obstacle {
  /** The leaf whose icon or label this is. */
  owner: string | undefined;
  part: 'icon' | 'label';
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
  const { obstacles, groups } = obstaclesOf(diagram.root, layout);
  const context = routeContext(diagram.root, layout, diagram.links);
  const report: CrossingReport = { crossings: [], unchecked: [] };
  const labels = placeLinkLabels(diagram, layout);
  const drawn: Placed[] = [];
  for (const link of diagram.links) {
    const path = predictPath(link, context);
    if (!path) {
      report.unchecked.push(link);
      continue;
    }
    const warn = (message: string) => report.crossings.push({ message, ...link.location });
    const corner = cornerOf(link);
    if (corner) {
      const { end, advice } = corner;
      warn(
        `link ${linkText(link)} has an end at the corner of "${end.id}", where draw.io may start the line along either edge; use ${advice}`,
      );
      continue;
    }
    const segments = segmentsOf(path);
    for (const obstacle of obstacles) {
      if (isOwnIcon(obstacle, link)) continue;
      if (!segments.some(([a, b]) => crosses(a, b, obstacle.rect))) continue;
      warn(`link ${linkText(link)} crosses ${obstacle.name}`);
    }
    for (const group of groups) {
      if (
        borderOf(group.rect).some((edge) => segments.some((segment) => alongside(edge, segment)))
      ) {
        warn(`link ${linkText(link)} runs along the border of ${group.name}`);
      }
    }
    for (const covered of labels.get(link)?.covers ?? []) {
      warn(`the label of link ${linkText(link)} covers ${covered}`);
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

// A line touches the icon at its end on purpose, but must not run through that icon's label
function isOwnIcon({ owner, part }: Obstacle, link: Link): boolean {
  return part === 'icon' && (owner === link.from.id || owner === link.to.id);
}

// draw.io starts a line from a corner along either edge, so its route cannot be predicted
function cornerOf(link: Link): { end: Endpoint; advice: string } | undefined {
  for (const end of [link.from, link.to]) {
    const advice = end.position && CORNER_ADVICE[end.position];
    if (advice) return { end, advice };
  }
  return undefined;
}

const CORNER_ADVICE: Partial<Record<Position, string>> = {
  ne: 'nne or ene',
  se: 'sse or ese',
  sw: 'ssw or wsw',
  nw: 'nnw or wnw',
};

/** Where a line's label goes: draw.io's position along the line, from -1 at the start to 1 at the end. */
export interface LabelPlace {
  position: number;
  /** The icons and labels it covers even there, when no place along the line is clear of them. */
  covers: string[];
}

// Halfway first, then step by step further out, but not so near the ends that the label sits on an
// icon
const LABEL_FRACTIONS = Array.from({ length: 17 }, (_, index) => 0.1 + index * 0.05).toSorted(
  (a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5),
);

/** A place along each labeled line whose label covers no icon or label, nor a group border if it can. */
export function placeLinkLabels(diagram: Diagram, layout: Layout): Map<Link, LabelPlace> {
  const { obstacles, groups } = obstaclesOf(diagram.root, layout);
  const context = routeContext(diagram.root, layout, diagram.links);
  const places = new Map<Link, LabelPlace>();
  for (const link of diagram.links) {
    const path = link.label === '' ? undefined : predictPath(link, context);
    if (!path) continue;
    const coveredAt = (fraction: number) => {
      const rect = linkLabelRect(path, link.label, fraction);
      return obstacles
        .filter((obstacle) => overlapsRect(rect, obstacle.rect))
        .map(({ name }) => name);
    };
    const onBorderAt = (fraction: number) => {
      const rect = linkLabelRect(path, link.label, fraction);
      return groups.some((group) => borderOf(group.rect).some(([a, b]) => crosses(a, b, rect)));
    };
    // A label on a group's border only hides a bit of it, and between groups packed close there
    // may be no room off the borders, so a clear border is preferred but not required
    const clear = LABEL_FRACTIONS.filter((fraction) => coveredAt(fraction).length === 0);
    const best = clear.find((fraction) => !onBorderAt(fraction)) ?? clear[0];
    places.set(
      link,
      best === undefined
        ? { position: 0, covers: coveredAt(0.5) }
        : { position: Math.round((best * 2 - 1) * 100) / 100, covers: [] },
    );
  }
  return places;
}

// draw.io puts a line's label at a fraction of its length, with a white background
function linkLabelRect(path: Point[], label: string, fraction: number): Rect {
  const lengths = segmentsOf(path).map(([a, b]) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
  let rest = lengths.reduce((sum, length) => sum + length, 0) * fraction;
  let middle = path[0] ?? { x: 0, y: 0 };
  for (const [index, [a, b]] of segmentsOf(path).entries()) {
    const length = lengths[index] ?? 0;
    if (rest <= length) {
      const t = length === 0 ? 0 : rest / length;
      middle = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      break;
    }
    rest -= length;
  }
  const { width, height } = labelSize(label);
  return trimEnds({ x: middle.x - width / 2, y: middle.y - height / 2, width, height });
}

function borderOf({ x, y, width, height }: Rect): Segment[] {
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  return corners.map((corner, index) => [corner, corners[(index + 1) % 4] ?? corner]);
}

export function linkText(link: Link): string {
  return `${endpointText(link.from)} -> ${endpointText(link.to)}`;
}

function obstaclesOf(
  root: DiagramNode,
  layout: Layout,
): { obstacles: Obstacle[]; groups: { name: string; rect: Rect }[] } {
  const obstacles: Obstacle[] = [];
  const groups: { name: string; rect: Rect }[] = [];
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
    groups.push({ name: groupName, rect });
    if (label.width > 0) {
      obstacles.push({
        owner: undefined,
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

function trimEnds(rect: Rect): Rect {
  return { ...rect, x: rect.x + LABEL_SLACK, width: rect.width - LABEL_SLACK * 2 };
}

function overlapsRect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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
