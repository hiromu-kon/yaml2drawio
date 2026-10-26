import { GROUP_PADDING, type Layout, type Rect } from './layout.ts';
import type { DiagramNode, Endpoint, GroupNode, LeafNode, Link } from './model.ts';
import { POSITION_POINTS, sideOf } from './position.ts';

export interface Point {
  x: number;
  y: number;
}

export interface RouteContext {
  layout: Layout;
  leaves: Map<string, LeafNode>;
  /** The group each leaf sits inside; border children are left out because they sit on its edge. */
  enclosing: Map<string, GroupNode>;
  /** The group each group sits inside. */
  parents: Map<GroupNode, GroupNode>;
}

const GAP = GROUP_PADDING / 2;

export function routeContext(root: DiagramNode, layout: Layout): RouteContext {
  const context: RouteContext = {
    layout,
    leaves: new Map(),
    enclosing: new Map(),
    parents: new Map(),
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
  return sideEntry(link, context) ?? leaveGroup(link, context) ?? sameSideLoop(link, context) ?? [];
}

// A line entering a leaf from the left or right bends just outside the group around that leaf
function sideEntry(link: Link, context: RouteContext): Point[] | undefined {
  const side = link.to.position && sideOf(link.to.position);
  const group = context.enclosing.get(link.to.id);
  if ((side !== 'left' && side !== 'right') || !group) return undefined;

  const box = rectOf(context, group);
  // A line from inside the same group would have to leave it and come back
  const source = leafRect(context, link.from.id);
  if (source && contains(box, center(source))) return undefined;

  const target = anchor(context, link.to);
  if (!target) return undefined;
  return [{ x: side === 'left' ? box.x - GAP : box.x + box.width + GAP, y: target.y }];
}

// A line leaving a group through its bottom (or top) turns in the gap just below (or above) it
function leaveGroup(link: Link, context: RouteContext): Point[] | undefined {
  const exit = link.from.position && sideOf(link.from.position);
  const entry = link.to.position && sideOf(link.to.position);
  const downward = exit === 'bottom' && entry === 'top';
  const upward = exit === 'top' && entry === 'bottom';
  const group = context.enclosing.get(link.from.id);
  const source = anchor(context, link.from);
  const target = anchor(context, link.to);
  if ((!downward && !upward) || !group || !source || !target) return undefined;

  const box = rectOf(context, group);
  if (contains(box, target)) return undefined;
  const y = downward ? box.y + box.height + GAP : box.y - GAP;
  if (downward ? target.y < y : target.y > y) return undefined;
  return [
    { x: source.x, y },
    { x: target.x, y },
  ];
}

// A line from a bottom side to another bottom side (or top to top) passes below (or above) the
// outermost groups that hold each end without holding the other, so it clears the labels next to
// its ends and anything placed between them
function sameSideLoop(link: Link, context: RouteContext): Point[] | undefined {
  const exit = link.from.position && sideOf(link.from.position);
  const entry = link.to.position && sideOf(link.to.position);
  const source = anchor(context, link.from);
  const target = anchor(context, link.to);
  if (exit !== entry || (exit !== 'bottom' && exit !== 'top') || !source || !target) {
    return undefined;
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
    { x: source.x, y },
    { x: target.x, y },
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

function anchor(context: RouteContext, endpoint: Endpoint): Point | undefined {
  const rect = leafRect(context, endpoint.id);
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
