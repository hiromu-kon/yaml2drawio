import type { Layout, Rect } from './layout.ts';
import type { Problem } from './load.ts';
import type { Diagram, Endpoint, Link } from './model.ts';
import type { Position } from './schema.ts';
import {
  alongside,
  linesAlong,
  predictPath,
  routeContext,
  segmentsOf,
  type Placed,
  type Point,
} from './route.ts';
import { labelSize } from './text.ts';
import { obstaclesOf, borderOf, crosses, overlapsRect, isOwnIcon } from './obstacles.ts';

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
    const warn = (code: string, message: string, relatedId?: string) =>
      report.crossings.push({
        code,
        message,
        linkId: link.id,
        ...(relatedId && { relatedId }),
        ...link.location,
      });
    const corner = cornerOf(link);
    if (corner) {
      const { end, advice } = corner;
      warn(
        'corner-end',
        `link ${linkText(link)} has an end at the corner of "${end.id}", where draw.io may start the line along either edge; use ${advice}`,
      );
      continue;
    }
    const segments = segmentsOf(path);
    for (const obstacle of obstacles) {
      if (isOwnIcon(obstacle, link)) continue;
      if (!segments.some(([a, b]) => crosses(a, b, obstacle.rect))) continue;
      warn(
        `crossing-${obstacle.part}`,
        `link ${linkText(link)} crosses ${obstacle.name}`,
        obstacle.owner,
      );
    }
    for (const group of groups) {
      if (
        borderOf(group.rect).some((edge) => segments.some((segment) => alongside(edge, segment)))
      ) {
        warn(
          'along-border',
          `link ${linkText(link)} runs along the border of ${group.name}`,
          group.id,
        );
      }
    }
    for (const covered of labels.get(link)?.covers ?? []) {
      warn(
        'label-overlap',
        `the label of link ${linkText(link)} covers ${covered.name}`,
        covered.id,
      );
    }
    for (const other of linesAlong(link, segments, drawn)) {
      report.crossings.push({
        code: 'overlapping-links',
        linkId: link.id,
        relatedId: other.id,
        message: `link ${linkText(link)} runs along link ${linkText(other)}`,
        ...link.location,
      });
    }
    drawn.push({ link, segments });
  }
  return report;
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
  covers: { name: string; id: string | undefined }[];
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
  const placed: { owner: string; name: string; rect: Rect }[] = [];
  for (const link of diagram.links) {
    const path = link.label === '' ? undefined : predictPath(link, context);
    if (!path) continue;
    const coveredAt = (fraction: number) => {
      const rect = linkLabelRect(path, link.label, fraction);
      return [...obstacles, ...placed]
        .filter((obstacle) => overlapsRect(rect, obstacle.rect))
        .map(({ name, owner }) => ({ name, id: owner }));
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
    const rect = linkLabelRect(path, link.label, best ?? 0.5);
    placed.push({
      owner: link.id,
      name: `the label of link ${linkText(link)}`,
      rect: { x: rect.x - 8, y: rect.y - 4, width: rect.width + 16, height: rect.height + 8 },
    });
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
  return { x: middle.x - width / 2, y: middle.y - height / 2, width, height };
}

export function linkText(link: Link): string {
  return `${endpointText(link.from)} -> ${endpointText(link.to)}`;
}

function endpointText({ id, position }: Endpoint): string {
  return position ? `${id}.${position}` : id;
}
