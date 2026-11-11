import { GROUP_PADDING, labelBelow, type Layout, type Rect } from './layout.ts';
import type { DiagramNode, Direction, Endpoint, GroupNode, LeafNode, Link } from './model.ts';
import { POSITION_POINTS, sideOf, type Side } from './position.ts';
import { crosses, obstaclesOf, type Obstacle } from './obstacles.ts';

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
  obstacles: Obstacle[];
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
    obstacles: obstaclesOf(root, layout).obstacles,
  };
  const visit = (node: DiagramNode, parent: GroupNode | undefined, onBorder = false): void => {
    if (node.kind === 'empty') return;
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

// Keep the existing rule order for ties, but prefer routes clear of icons, labels and earlier lines.
function chooseBends(link: Link, context: RouteContext, lines: Placed[]): Point[] {
  if (link.route === 'drawio') return [];
  const options = [selfLoop, sideEntry, leaveGroup, fanOut, sameSideLoop]
    .flatMap((rule) => rule(link, context))
    .filter((option) => leavesForward(link, option, context));
  options.push([]);
  const score = (bends: Point[]): number[] => {
    const path = predictPath(link, context, bends);
    if (!path) return [0, 0, 0];
    const segments = segmentsOf(path);
    const hits = context.obstacles.filter((obstacle) =>
      segments.some(([a, b]) => crosses(a, b, obstacle.rect)),
    );
    return [
      hits.filter((hit) => hit.part === 'icon').length,
      hits.filter((hit) => hit.part === 'label').length,
      linesAlong(link, segments, lines).length,
    ];
  };
  const initial = options[0] ?? [];
  const path = predictPath(link, context, initial);
  const hits =
    path &&
    context.obstacles.filter((obstacle) =>
      segmentsOf(path).some(([a, b]) => crosses(a, b, obstacle.rect)),
    );
  if (hits?.length) options.push(...detours(link, context, hits));
  return (
    options
      .map((bends) => ({ bends, score: score(bends) }))
      .toSorted((a, b) => {
        for (let i = 0; i < a.score.length; i++) {
          const difference = (a.score[i] ?? 0) - (b.score[i] ?? 0);
          if (difference !== 0) return difference;
        }
        return 0;
      })[0]?.bends ?? []
  );
}

// Candidate lanes surround obstacles for every pair of endpoint directions, including
// opposite sides on vertically/horizontally stacked icons. End gates keep each port's direction.
function detours(link: Link, context: RouteContext, obstacles: Obstacle[]): Point[][] {
  const start = departure(context, link),
    end = arrival(context, link);
  if (!start || !end || !link.from.position || !link.to.position) return [];
  const gate = (point: Point, side: Side, owner: string): Point => {
    const result = outward(point, side, JETTY);
    for (const obstacle of context.obstacles.filter((item) => item.owner === owner)) {
      const r = obstacle.rect;
      if (side === 'left') result.x = Math.min(result.x, r.x - GAP);
      if (side === 'right') result.x = Math.max(result.x, r.x + r.width + GAP);
      if (side === 'top') result.y = Math.min(result.y, r.y - GAP);
      if (side === 'bottom') result.y = Math.max(result.y, r.y + r.height + GAP);
    }
    return result;
  };
  const source = gate(start, sideOf(link.from.position), link.from.id);
  const target = gate(end, sideOf(link.to.position), link.to.id);
  return obstacles.flatMap(({ rect }) => [
    ...[rect.y - GAP, rect.y + rect.height + GAP].map((y) => [
      source,
      { x: source.x, y },
      { x: target.x, y },
      target,
    ]),
    ...[rect.x - GAP, rect.x + rect.width + GAP].map((x) => [
      source,
      { x, y: source.y },
      { x, y: target.y },
      target,
    ]),
  ]);
}

// A self-link needs a nonzero loop even when both ports are identical. Route round the icon
// and its label in either direction; scoring chooses the side clear of other objects.
function selfLoop(link: Link, context: RouteContext): Point[][] {
  if (link.from.id !== link.to.id || !link.from.position || !link.to.position) return [];
  const start = departure(context, link),
    end = arrival(context, link);
  const box = context.leaves.get(link.from.id) ?? context.groups.get(link.from.id);
  if (!start || !end || !box) return [];
  const own = [
    rectOf(context, box),
    ...context.obstacles.filter((ob) => ob.owner === link.from.id).map((ob) => ob.rect),
  ];
  const left = Math.min(...own.map((r) => r.x)) - JETTY;
  const right = Math.max(...own.map((r) => r.x + r.width)) + JETTY;
  const top = Math.min(...own.map((r) => r.y)) - JETTY;
  const bottom = Math.max(...own.map((r) => r.y + r.height)) + JETTY;
  const sides: Side[] = ['top', 'right', 'bottom', 'left'];
  const exit = sideOf(link.from.position),
    entry = sideOf(link.to.position);
  const gate = (point: Point, side: Side): Point =>
    side === 'top'
      ? { x: point.x, y: top }
      : side === 'bottom'
        ? { x: point.x, y: bottom }
        : side === 'left'
          ? { x: left, y: point.y }
          : { x: right, y: point.y };
  const corners = [
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ];
  return [1, -1].map((step) => {
    let side = sides.indexOf(exit);
    const target = sides.indexOf(entry);
    const points = [gate(start, exit)];
    do {
      const corner = corners[(side + (step > 0 ? 0 : 3)) % 4];
      if (corner) points.push(corner);
      side = (side + step + 4) % 4;
    } while (side !== target);
    points.push(gate(end, entry));
    return points;
  });
}

// A first bend behind the side a line leaves from would make it turn back on itself (leave the
// right side, then head left), so such options are skipped
function leavesForward(link: Link, bends: Point[], context: RouteContext): boolean {
  const source = departure(context, link);
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
  const start = departure(context, link);
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
  const source = departure(context, link);
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
  const source = departure(context, link);
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
  const source = departure(context, link);
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

/** Where a line starts: the point on the side of its source, moved along it by levelShift. */
export function departure(context: RouteContext, link: Link): Point | undefined {
  const start = anchor(context, link.from);
  if (!start) return undefined;
  const { exit } = levelShift(link, context);
  return { x: start.x + exit.x, y: start.y + exit.y };
}

/** Where a line ends: the point on the side of its target, moved along it by levelShift. */
export function arrival(context: RouteContext, link: Link): Point | undefined {
  const end = anchor(context, link.to);
  if (!end) return undefined;
  const { entry } = levelShift(link, context);
  return { x: end.x + entry.x, y: end.y + entry.y };
}

/**
 * How far a line leaves its source and enters its target off the middle of the sides. Between two
 * icons that face each other and are almost level, draw.io would put a small step halfway, which
 * reads as a mistake; meeting a little off the middle keeps the line straight. The target end moves
 * first, and the source end only for what is left, since a point several lines leave from cannot
 * move for one of them. Each end stays within the middle half of its side, so the line still
 * clearly meets the icon, and its arrowhead does not reach past it onto the label.
 */
export function levelShift(link: Link, context: RouteContext): { exit: Point; entry: Point } {
  const none = { exit: { x: 0, y: 0 }, entry: { x: 0, y: 0 } };
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
  const along = (point: Point) => (horizontal ? point.y : point.x);
  const reach = (rect: Rect, point: number): [number, number] => {
    const [from, length] = horizontal ? [rect.y, rect.height] : [rect.x, rect.width];
    return [
      Math.max(point - length / 4, from + length / 4),
      Math.min(point + length / 4, from + (length * 3) / 4),
    ];
  };
  const [targetLow, targetHigh] = reach(target, along(end));
  const source = leafRect(context, link.from.id);
  const shared = context.links.some(
    (other) => other !== link && pointKey(other.from) === pointKey(link.from),
  );
  const [sourceLow, sourceHigh] =
    source && !shared ? reach(source, along(start)) : [along(start), along(start)];
  // The level both ends can reach that moves the source end least
  const low = Math.max(targetLow, sourceLow);
  const high = Math.min(targetHigh, sourceHigh);
  if (along(start) === along(end) || low > high) return none;
  const level = Math.min(Math.max(along(start), low), high);
  const shift = (from: number): Point =>
    horizontal ? { x: 0, y: level - from } : { x: level - from, y: 0 };
  return { exit: shift(along(start)), entry: shift(along(end)) };
}

export function anchor(context: RouteContext, endpoint: Endpoint): Point | undefined {
  const group = context.groups.get(endpoint.id);
  const rect = group ? rectOf(context, group) : leafRect(context, endpoint.id);
  if (!rect || !endpoint.position) return undefined;
  const [px, py] = POSITION_POINTS[endpoint.position];
  return {
    x: rect.x + px * rect.width,
    y: rect.y + py * rect.height + labelShift(context, endpoint),
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
  // Native draw.io routing is intentionally unchecked: its implicit bends depend on its
  // renderer/version. Automatic routes are written with these exact orthogonal segments.
  if (link.route === 'drawio') return undefined;
  const start = departure(context, link),
    end = arrival(context, link);
  if (!start || !end || !link.from.position || !link.to.position) return undefined;
  const exit = sideOf(link.from.position),
    entry = sideOf(link.to.position);
  const facing =
    (exit === 'right' && entry === 'left' && start.x < end.x) ||
    (exit === 'left' && entry === 'right' && start.x > end.x) ||
    (exit === 'bottom' && entry === 'top' && start.y < end.y) ||
    (exit === 'top' && entry === 'bottom' && start.y > end.y);
  if (
    bends.length === 0 &&
    facing &&
    (exit === 'left' || exit === 'right' ? start.y === end.y : start.x === end.x)
  )
    return [start, end];
  const distance = facing
    ? Math.abs(exit === 'left' || exit === 'right' ? end.x - start.x : end.y - start.y) / 2
    : JETTY;
  const gate = (point: Point, side: Side, hint: Point | undefined): Point => {
    let length = Math.min(JETTY, distance);
    if (hint) {
      const forward =
        side === 'right'
          ? hint.x - point.x
          : side === 'left'
            ? point.x - hint.x
            : side === 'bottom'
              ? hint.y - point.y
              : point.y - hint.y;
      const level = side === 'left' || side === 'right' ? hint.y === point.y : hint.x === point.x;
      if (level && forward >= 0) length = Math.min(length, forward);
    }
    return outward(point, side, length);
  };
  const source = gate(start, exit, bends[0]);
  const target = gate(end, entry, bends.at(-1));
  const path = [start, source];
  let heading = directionOf(exit);
  for (const point of [...bends, target]) heading = turnTowards(path, heading, point);
  path.push(end);
  return simplify(path);
}

function outward(point: Point, side: Side, distance: number): Point {
  return {
    x: point.x + (side === 'right' ? distance : side === 'left' ? -distance : 0),
    y: point.y + (side === 'bottom' ? distance : side === 'top' ? -distance : 0),
  };
}

function turnTowards(path: Point[], heading: Direction, to: Point): Direction {
  const from = path.at(-1) ?? to;
  if (from.x === to.x && from.y === to.y) return heading;
  if (from.x !== to.x && from.y !== to.y)
    path.push(heading === 'horizontal' ? { x: to.x, y: from.y } : { x: from.x, y: to.y });
  path.push(to);
  const last = path.at(-2) ?? from;
  return last.y === to.y ? 'horizontal' : 'vertical';
}

function simplify(points: Point[]): Point[] {
  const path: Point[] = [];
  for (const point of points) {
    const previous = path.at(-1);
    if (previous?.x === point.x && previous.y === point.y) continue;
    const before = path.at(-2);
    if (
      before &&
      previous &&
      ((before.x === previous.x &&
        previous.x === point.x &&
        (previous.y - before.y) * (point.y - previous.y) > 0) ||
        (before.y === previous.y &&
          previous.y === point.y &&
          (previous.x - before.x) * (point.x - previous.x) > 0))
    )
      path.pop();
    path.push(point);
  }
  return path;
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
  return (
    a.from.id === b.from.id &&
    a.from.position === b.from.position &&
    a.dashed === b.dashed &&
    a.arrow === b.arrow
  );
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
