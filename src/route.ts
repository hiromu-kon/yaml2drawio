import { GROUP_PADDING, labelBelow, type Layout, type Rect } from './layout.ts';
import type { DiagramNode, Endpoint, GroupNode, LeafNode, Link } from './model.ts';
import { POSITION_POINTS, sideOf } from './position.ts';

export interface Point {
  x: number;
  y: number;
}

export interface RouteContext {
  layout: Layout;
  leaves: Map<string, LeafNode>;
  groups: Map<string, GroupNode>;
  /** The group each leaf sits inside; border children are left out because they sit on its edge. */
  enclosing: Map<string, GroupNode>;
  /** The group each group sits inside. */
  parents: Map<GroupNode, GroupNode>;
  links: readonly Link[];
}

const GAP = GROUP_PADDING / 2;

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
    for (const { node: child } of node.border) visit(child, node, true);
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
  if (link.route === 'drawio') return [];
  for (const rule of [sideEntry, leaveGroup, fanOut, sameSideLoop]) {
    const bends = rule(link, context).find((option) => leavesForward(link, option, context));
    if (bends) return bends;
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
// nested inside
function sideEntry(link: Link, context: RouteContext): Point[][] {
  const side = link.to.position && sideOf(link.to.position);
  const source = leafRect(context, link.from.id);
  const target = anchor(context, link.to);
  if ((side !== 'left' && side !== 'right') || !source || !target) return [];

  return enteredGroups(context, link.to.id, center(source))
    .toReversed()
    .map((group) => {
      const box = rectOf(context, group);
      return [{ x: side === 'left' ? box.x - GAP : box.x + box.width + GAP, y: target.y }];
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
  const target = anchor(context, link.to);
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
  const target = anchor(context, link.to);
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
    const leaf = first && context.leaves.get(first.from.id);
    const ends = links.flatMap((link) => {
      const end = anchor(context, link.to);
      return end ? [{ link, end }] : [];
    });
    if (links.length < 2 || !source || !leaf || ends.length === 0) return [];
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
        // Above the label of the source there is no room to turn
        floor: source.y + labelBelow(leaf),
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
  const target = anchor(context, link.to);
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

export function anchor(context: RouteContext, endpoint: Endpoint): Point | undefined {
  const group = context.groups.get(endpoint.id);
  const rect = group ? rectOf(context, group) : leafRect(context, endpoint.id);
  if (!rect || !endpoint.position) return undefined;
  const [px, py] = POSITION_POINTS[endpoint.position];
  return { x: Math.round(rect.x + px * rect.width), y: Math.round(rect.y + py * rect.height) };
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
