import { GROUP_PADDING, labelBelow, type Layout, type Rect } from './layout.ts';
import type { DiagramNode, Direction, Endpoint, GroupNode, LeafNode, Link } from './model.ts';
import { POSITION_POINTS, sideOf, type Side } from './position.ts';

export interface Point {
  x: number;
  y: number;
}

export type Segment = readonly [Point, Point];

/** A link and the line predicted for it. */
export interface Placed {
  link: Link;
  segments: Segment[];
}

export interface RouteContext {
  layout: Layout;
  leaves: Map<string, LeafNode>;
  groups: Map<string, GroupNode>;
  /** The group each leaf sits inside; border children are left out because they sit on its edge. */
  enclosing: Map<string, GroupNode>;
  /** The group each group sits inside. */
  parents: Map<GroupNode, GroupNode>;
  /** Leaves on a group's left or right edge, whose labels sit beside them instead of below. */
  besideLabels: Set<string>;
  links: readonly Link[];
}

const GAP = GROUP_PADDING / 2;
// How far draw.io runs a line out of a side before turning back, when both ends face the same way
const JETTY = 20;

export function routeContext(
  root: DiagramNode,
  layout: Layout,
  links: readonly Link[] = [],
): RouteContext {
  const context: RouteContext = {
    layout,
    leaves: new Map(),
    groups: new Map(),
    enclosing: new Map(),
    parents: new Map(),
    besideLabels: new Set(),
    links,
  };
  const visit = (node: DiagramNode, parent: GroupNode | undefined, onBorder = false): void => {
    if (node.kind === 'stack') {
      for (const child of node.children) visit(child, parent);
      return;
    }
    if (node.kind === 'leaf') {
      context.leaves.set(node.id, node);
      if (parent && !onBorder) context.enclosing.set(node.id, parent);
      return;
    }
    context.groups.set(node.id, node);
    if (parent) context.parents.set(node, parent);
    for (const child of node.children) visit(child, node);
    for (const { node: child, position } of node.border) {
      const side = sideOf(position);
      if (side === 'left' || side === 'right') context.besideLabels.add(child.id);
      visit(child, node, true);
    }
  };
  visit(root, undefined);
  return context;
}

/**
 * Bend points for a link, or none to leave the route to draw.io. draw.io bends a line halfway
 * between its ends or about 20px from a side, which is often right over a group's label. These
 * rules move the bends into the gaps around groups instead.
 */
export function bendPoints(link: Link, context: RouteContext): Point[] {
  return placedBends(context).get(link) ?? chooseBends(link, context, []);
}

const placedCache = new WeakMap<RouteContext, Map<Link, Point[]>>();

// Links are placed in order, and a later line keeps off the lines placed before it
function placedBends(context: RouteContext): Map<Link, Point[]> {
  const cached = placedCache.get(context);
  if (cached) return cached;
  const bends = new Map<Link, Point[]>();
  const lines: Placed[] = [];
  for (const link of context.links) {
    const chosen = chooseBends(link, context, lines);
    bends.set(link, chosen);
    const path = predictPath(link, context, chosen);
    if (path) lines.push({ link, segments: segmentsOf(path) });
  }
  placedCache.set(context, bends);
  return bends;
}

// The first rule that applies decides; of the places it may bend, the first that keeps the line off
// the lines already placed, or else its first
function chooseBends(link: Link, context: RouteContext, lines: Placed[]): Point[] {
  if (link.route === 'drawio') return [];
  for (const rule of [sideEntry, leaveGroup, fanOut, sameSideLoop]) {
    const options = rule(link, context).filter((option) => leavesForward(link, option, context));
    const clear = options.find((option) => {
      const path = predictPath(link, context, option);
      return !path || linesAlong(link, segmentsOf(path), lines).length === 0;
    });
    const chosen = clear ?? options[0];
    if (chosen) return chosen;
  }
  return [];
}

// A first bend behind the side a line leaves from would make it turn back on itself (leave the
// right side, then head left), so such options are skipped
function leavesForward(link: Link, bends: Point[], context: RouteContext): boolean {
  const source = anchor(context, link.from);
  const first = bends[0];
  if (!source || !first || !link.from.position) return true;
  const side = sideOf(link.from.position);
  if (side === 'right') return first.x >= source.x;
  if (side === 'left') return first.x <= source.x;
  if (side === 'bottom') return first.y >= source.y;
  return first.y <= source.y;
}

// A line entering a leaf from the left or right bends just outside the groups it has to enter,
// the outermost first, so it runs down beside them rather than through the labels of the groups
// nested inside. A line leaving a top or bottom side first turns in the gap above (or below) that
// group: left to draw.io, it would turn about 20px out of the side, wherever that is.
function sideEntry(link: Link, context: RouteContext): Point[][] {
  const side = link.to.position && sideOf(link.to.position);
  const exit = link.from.position && sideOf(link.from.position);
  const source = leafRect(context, link.from.id);
  const start = anchor(context, link.from);
  const target = arrival(context, link);
  if ((side !== 'left' && side !== 'right') || !source || !start || !target) return [];

  return enteredGroups(context, link.to.id, center(source))
    .toReversed()
    .map((group) => {
      const box = rectOf(context, group);
      const x = side === 'left' ? box.x - GAP : box.x + box.width + GAP;
      const beside = { x, y: target.y };
      if (exit !== 'top' && exit !== 'bottom') return [beside];
      const y = exit === 'bottom' ? box.y - GAP : box.y + box.height + GAP;
      return [{ x: start.x, y }, { x, y }, beside];
    });
}

// A line leaving a group through its bottom (or top) turns in the gap just below (or above) the
// groups it has to leave, the outermost first
function leaveGroup(link: Link, context: RouteContext): Point[][] {
  const exit = link.from.position && sideOf(link.from.position);
  const entry = link.to.position && sideOf(link.to.position);
  const downward = exit === 'bottom' && entry === 'top';
  const upward = exit === 'top' && entry === 'bottom';
  const source = anchor(context, link.from);
  const target = arrival(context, link);
  if ((!downward && !upward) || !source || !target) return [];

  return enteredGroups(context, link.from.id, target)
    .toReversed()
    .map((group) => {
      const box = rectOf(context, group);
      return downward ? box.y + box.height + GAP : box.y - GAP;
    })
    .filter((y) => (downward ? target.y >= y : target.y <= y))
    .map((y) => [
      { x: source.x, y },
      { x: target.x, y },
    ]);
}

/**
 * The groups around a leaf, innermost first, up to the first one that holds the point: the groups a
 * line from that point has to enter. A line from inside the innermost group enters none.
 */
function enteredGroups(context: RouteContext, id: string, point: Point): GroupNode[] {
  const entered: GroupNode[] = [];
  for (const group of ancestors(context, id)) {
    if (contains(rectOf(context, group), point)) break;
    entered.push(group);
  }
  return entered;
}

// Lines leaving one point downward to the tops of several icons share the height they turn at, the
// gap just above the highest group they enter; draw.io would turn each halfway to its own target,
// and targets of different heights would split the shared part into steps
function fanOut(link: Link, context: RouteContext): Point[][] {
  const y = fanOutHeights(context).get(pointKey(link.from));
  const source = anchor(context, link.from);
  const target = arrival(context, link);
  if (y === undefined || !source || !target || !link.to.position) return [];
  if (sideOf(link.to.position) !== 'top') return [];
  return [
    [
      { x: source.x, y },
      { x: target.x, y },
    ],
  ];
}

const fanOutCache = new WeakMap<RouteContext, Map<string, number>>();

/** The height each fan-out turns at, keyed by the point it leaves from. */
function fanOutHeights(context: RouteContext): Map<string, number> {
  const cached = fanOutCache.get(context);
  if (cached) return cached;

  const fans = new Map<string, Link[]>();
  for (const link of context.links) {
    if (!link.from.position || !link.to.position) continue;
    if (sideOf(link.from.position) !== 'bottom' || sideOf(link.to.position) !== 'top') continue;
    const key = pointKey(link.from);
    fans.set(key, [...(fans.get(key) ?? []), link]);
  }
  const candidates = [...fans].flatMap(([key, links]) => {
    const [first] = links;
    const source = first && anchor(context, first.from);
    const ends = links.flatMap((link) => {
      const end = arrival(context, link);
      return end ? [{ link, end }] : [];
    });
    if (links.length < 2 || !source || ends.length === 0) return [];
    const heights = ends.map(({ link, end }) => {
      const outermost = enteredGroups(context, link.to.id, source).at(-1);
      return (outermost ? rectOf(context, outermost).y : end.y) - GAP;
    });
    const xs = [source.x, ...ends.map(({ end }) => end.x)];
    return [
      {
        key,
        source,
        y: Math.min(...heights),
        // The source point is below its label already; above it there is no room to turn
        floor: source.y,
        left: Math.min(...xs),
        right: Math.max(...xs),
      },
    ];
  });

  // Fans running along the same stretch at the same height read as one line, so each later one
  // turns a lane higher
  const heights = new Map<string, number>();
  const placed: { y: number; left: number; right: number }[] = [];
  for (const fan of candidates.toSorted((a, b) => a.source.x - b.source.x)) {
    let { y } = fan;
    while (
      placed.some((other) => other.y === y && other.left < fan.right && fan.left < other.right)
    ) {
      y -= GAP;
    }
    if (y <= fan.floor) continue;
    heights.set(fan.key, y);
    placed.push({ y, left: fan.left, right: fan.right });
  }
  fanOutCache.set(context, heights);
  return heights;
}

function pointKey({ id, position }: Endpoint): string {
  return `${id}.${position ?? ''}`;
}

// A line from a bottom side to another bottom side (or top to top) passes below (or above) the
// outermost groups that hold each end without holding the other, so it clears the labels next to
// its ends and anything placed between them
function sameSideLoop(link: Link, context: RouteContext): Point[][] {
  const exit = link.from.position && sideOf(link.from.position);
  const entry = link.to.position && sideOf(link.to.position);
  const source = anchor(context, link.from);
  const target = arrival(context, link);
  if (exit !== entry || (exit !== 'bottom' && exit !== 'top') || !source || !target) {
    return [];
  }

  const [fromChain, toChain] = [link.from.id, link.to.id].map((id) => ancestors(context, id));
  const common = fromChain?.find((group) => toChain?.includes(group));
  const boxes = [
    [link.from.id, fromChain],
    [link.to.id, toChain],
  ] as const;
  const rects = boxes.map(([id, chain]) => {
    const below = chain ? chain.slice(0, common ? chain.indexOf(common) : chain.length) : [];
    const outermost = below.at(-1);
    return outermost ? rectOf(context, outermost) : leafRect(context, id);
  });
  const y =
    exit === 'bottom'
      ? Math.max(...rects.map((box) => (box ? box.y + box.height : source.y))) + GAP
      : Math.min(...rects.map((box) => (box ? box.y : source.y))) - GAP;
  return [
    [
      { x: source.x, y },
      { x: target.x, y },
    ],
  ];
}

/** The groups around a leaf, innermost first. */
function ancestors(context: RouteContext, id: string): GroupNode[] {
  const chain: GroupNode[] = [];
  for (let group = context.enclosing.get(id); group; group = context.parents.get(group)) {
    chain.push(group);
  }
  return chain;
}

/** Where a line ends: the point on the side of its target, moved along it by entryShift. */
export function arrival(context: RouteContext, link: Link): Point | undefined {
  const end = anchor(context, link.to);
  if (!end) return undefined;
  const shift = entryShift(link, context);
  return { x: end.x + shift.x, y: end.y + shift.y };
}

/**
 * How far a line enters its target off the middle of the side. Between two icons that face each
 * other and are almost level, draw.io would put a small step halfway, which reads as a mistake;
 * entering a little off the middle keeps the line straight. Only within the middle half of the side,
 * so the line still clearly meets the icon.
 */
export function entryShift(link: Link, context: RouteContext): Point {
  const none = { x: 0, y: 0 };
  const exit = link.from.position && sideOf(link.from.position);
  const entry = link.to.position && sideOf(link.to.position);
  const target = leafRect(context, link.to.id);
  const start = anchor(context, link.from);
  const end = anchor(context, link.to);
  if (!target || !start || !end) return none;
  const facing =
    (exit === 'right' && entry === 'left' && start.x < end.x) ||
    (exit === 'left' && entry === 'right' && start.x > end.x) ||
    (exit === 'bottom' && entry === 'top' && start.y < end.y) ||
    (exit === 'top' && entry === 'bottom' && start.y > end.y);
  if (!facing) return none;
  const horizontal = entry === 'left' || entry === 'right';
  const offset = horizontal ? start.y - end.y : start.x - end.x;
  // Only within the middle half of the side: nearer a corner, the arrowhead would reach past the
  // icon, onto its label
  const [from, length] = horizontal ? [target.y, target.height] : [target.x, target.width];
  const shifted = (horizontal ? end.y : end.x) + offset;
  const near = Math.abs(offset) <= length / 4;
  const inMiddle = shifted >= from + length / 4 && shifted <= from + (length * 3) / 4;
  if (offset === 0 || !near || !inMiddle) return none;
  return horizontal ? { x: 0, y: offset } : { x: offset, y: 0 };
}

export function anchor(context: RouteContext, endpoint: Endpoint): Point | undefined {
  const group = context.groups.get(endpoint.id);
  const rect = group ? rectOf(context, group) : leafRect(context, endpoint.id);
  if (!rect || !endpoint.position) return undefined;
  const [px, py] = POSITION_POINTS[endpoint.position];
  return {
    x: Math.round(rect.x + px * rect.width),
    y: Math.round(rect.y + py * rect.height) + labelShift(context, endpoint),
  };
}

// drawio.ts starts and ends a line at the bottom below the label under the icon
function labelShift(context: RouteContext, endpoint: Endpoint): number {
  const leaf = context.leaves.get(endpoint.id);
  if (!leaf || !endpoint.position || sideOf(endpoint.position) !== 'bottom') return 0;
  return context.besideLabels.has(leaf.id) ? 0 : labelBelow(leaf);
}

function leafRect(context: RouteContext, id: string): Rect | undefined {
  const leaf = context.leaves.get(id);
  return leaf && rectOf(context, leaf);
}

function rectOf(context: RouteContext, node: LeafNode | GroupNode): Rect {
  const rect = context.layout.cells.get(node);
  if (!rect) throw new Error(`no layout for "${node.id}"`);
  return rect;
}

function center({ x, y, width, height }: Rect): Point {
  return { x: x + width / 2, y: y + height / 2 };
}

function contains(box: Rect, { x, y }: Point): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/**
 * The path draw.io draws for a link, or undefined when an end has no side and draw.io picks it.
 * draw.io routes the parts of a line between its bend points, so the path is predicted the way it
 * usually draws them.
 */
export function predictPath(
  link: Link,
  context: RouteContext,
  bends: Point[] = bendPoints(link, context),
): Point[] | undefined {
  const start = anchor(context, link.from);
  const end = arrival(context, link);
  if (!start || !end || !link.from.position || !link.to.position) return undefined;

  const path = [start];
  let heading = directionOf(sideOf(link.from.position));
  for (const bend of bends) {
    heading = turnTowards(path, heading, bend);
  }
  const endShift = labelShift(context, link.to);
  // Off the outline, below a label, draw.io turns right at the end instead of running out first
  const jetty = endShift > 0 ? 0 : JETTY;
  // Halfway between two icons, draw.io measures from their outlines, above any label shift
  const startShift = bends.length === 0 ? labelShift(context, link.from) : 0;
  arrive(path, heading, end, sideOf(link.to.position), { jetty, startShift, endShift });
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
function arrive(
  path: Point[],
  heading: Direction,
  end: Point,
  side: Side,
  { jetty, startShift, endShift }: { jetty: number; startShift: number; endShift: number },
): void {
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
      ? (from.y - startShift + end.y - endShift) / 2
      : side === 'top'
        ? Math.min(from.y, end.y) - jetty
        : Math.max(from.y, end.y) + jetty;
    path.push({ x: from.x, y }, { x: end.x, y }, end);
  } else {
    const x = facing
      ? (from.x + end.x) / 2
      : side === 'left'
        ? Math.min(from.x, end.x) - jetty
        : Math.max(from.x, end.x) + jetty;
    path.push({ x, y: from.y }, { x, y: end.y }, end);
  }
}

function directionOf(side: Side): Direction {
  return side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
}

export function segmentsOf(path: Point[]): Segment[] {
  return path.slice(1).map((end, index): Segment => [path[index] ?? end, end]);
}

/**
 * The links of these lines that the line of a link runs along. Lines that share a stretch read as
 * one, so which way each goes is lost. Lines drawn alike that leave one point together and split
 * later still read as branches of one line, which is common, so they are left out.
 */
export function linesAlong(link: Link, segments: Segment[], lines: Placed[]): Link[] {
  return lines
    .filter((line) => !branches(line.link, link))
    .filter((line) =>
      line.segments.some((a) =>
        segments.some((b) => runsAlong(a, b, line.link.from.id === link.from.id ? 0 : JOIN)),
      ),
    )
    .map((line) => line.link);
}

function branches(a: Link, b: Link): boolean {
  return a.from.id === b.from.id && a.from.position === b.from.position && a.dashed === b.dashed;
}

// Lines this close side by side read as one
const ALONG = 3;
// Lines on one line whose ends are this close read as one line, too, which joins their ends. Lines
// from one icon may meet that way: read as one line, they still start where they do.
const JOIN = 16;

/** Whether two segments overlap side by side, close enough to read as one line. */
export function alongside(a: Segment, b: Segment): boolean {
  return runsAlong(a, b, 0);
}

function runsAlong([a, b]: Segment, [c, d]: Segment, gap: number): boolean {
  if (a.x === b.x && c.x === d.x) {
    return Math.abs(a.x - c.x) < ALONG && overlaps([a.y, b.y], [c.y, d.y], gap);
  }
  if (a.y === b.y && c.y === d.y) {
    return Math.abs(a.y - c.y) < ALONG && overlaps([a.x, b.x], [c.x, d.x], gap);
  }
  return false;
}

function overlaps([a1, a2]: [number, number], [b1, b2]: [number, number], gap = 0): boolean {
  return (
    Math.min(Math.max(a1, a2), Math.max(b1, b2)) + gap >
    Math.max(Math.min(a1, a2), Math.min(b1, b2))
  );
}
