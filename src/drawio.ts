import { GROUP_PADDING, type Layout, type Rect } from './layout.ts';
import type { Diagram, DiagramNode, Endpoint, GroupNode, LeafNode, Link } from './model.ts';
import { POSITION_POINTS, sideOf } from './position.ts';
import { LINE_HEIGHT } from './text.ts';

export function toDrawio(diagram: Diagram, layout: Layout): string {
  const cells: string[] = [];
  const leaves = new Map<string, LeafNode>();
  // The group each leaf sits inside; border children are left out because they sit on its edge
  const enclosing = new Map<string, GroupNode>();

  const visit = (node: DiagramNode, parent: GroupNode | undefined, onBorder = false): void => {
    if (node.kind === 'stack') {
      for (const child of node.children) visit(child, parent);
      return;
    }
    const geometry = relativeTo(cellRect(layout, node), parent && cellRect(layout, parent));
    if (node.kind === 'leaf') {
      leaves.set(node.id, node);
      if (parent && !onBorder) enclosing.set(node.id, parent);
      cells.push(vertex(node.id, node.label, node.shape.style, parent?.id, geometry));
      return;
    }
    cells.push(vertex(node.id, node.label, groupStyle(node.shape.style), parent?.id, geometry));
    for (const child of node.children) visit(child, node);
    // Border children belong to the group so that moving it in draw.io moves them too
    for (const { node: child } of node.border) visit(child, node, true);
  };
  visit(diagram.root, undefined);

  for (const link of diagram.links) {
    cells.push(edge(link, leaves, sideEntryBend(link, layout, leaves, enclosing)));
  }

  return [
    '<mxfile host="yaml2drawio">',
    `  <diagram id="yaml2drawio" name="${xml(diagram.title)}">`,
    `    <mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${layout.width}" pageHeight="${layout.height}" math="0" shadow="0">`,
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    ...cells.map((cell) => `        ${cell}`),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
    '',
  ].join('\n');
}

function cellRect(layout: Layout, node: LeafNode | GroupNode): Rect {
  const rect = layout.cells.get(node);
  if (!rect) throw new Error(`no layout for "${node.id}"`);
  return rect;
}

// draw.io positions a child cell relative to its parent cell
function relativeTo(rect: Rect, parent: Rect | undefined): Rect {
  return parent ? { ...rect, x: rect.x - parent.x, y: rect.y - parent.y } : rect;
}

function vertex(
  id: string,
  label: string,
  style: string,
  parent: string | undefined,
  { x, y, width, height }: Rect,
): string {
  return (
    `<mxCell id="${xml(id)}" value="${xml(html(label))}" style="${xml(style)}" vertex="1" parent="${xml(parent ?? '1')}">` +
    `<mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" /></mxCell>`
  );
}

function groupStyle(style: string): string {
  return style.includes('container=1') ? style : `${style}container=1;collapsible=0;`;
}

interface Point {
  x: number;
  y: number;
}

// draw.io bends a line about 20px before the side it enters, which is right where the label of
// the enclosing group sits. Bend it in the gap just outside that group instead.
function sideEntryBend(
  link: Link,
  layout: Layout,
  leaves: Map<string, LeafNode>,
  enclosing: Map<string, GroupNode>,
): Point | undefined {
  const { position, id } = link.to;
  if (!position) return undefined;
  const side = sideOf(position);
  const leaf = leaves.get(id);
  const group = enclosing.get(id);
  const source = leaves.get(link.from.id);
  if ((side !== 'left' && side !== 'right') || !leaf || !group) return undefined;

  const box = cellRect(layout, group);
  // A line from inside the same group would have to leave it and come back
  if (source && contains(box, center(cellRect(layout, source)))) return undefined;

  const target = cellRect(layout, leaf);
  const [, py] = POSITION_POINTS[position];
  const gap = GROUP_PADDING / 2;
  return {
    x: side === 'left' ? box.x - gap : box.x + box.width + gap,
    y: Math.round(target.y + py * target.height),
  };
}

function center({ x, y, width, height }: Rect): Point {
  return { x: x + width / 2, y: y + height / 2 };
}

function contains(box: Rect, { x, y }: Point): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function edge(link: Link, leaves: Map<string, LeafNode>, bend: Point | undefined): string {
  const style = [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=0',
    'orthogonalLoop=1',
    'jettySize=auto',
    'html=1',
    `endArrow=${link.arrow === 'end' || link.arrow === 'both' ? 'open' : 'none'}`,
    'endFill=0',
    `startArrow=${link.arrow === 'start' || link.arrow === 'both' ? 'open' : 'none'}`,
    'startFill=0',
    ...(link.dashed ? ['dashed=1'] : []),
    ...port('exit', link.from, leaves),
    ...port('entry', link.to, leaves),
  ].join(';');
  return (
    `<mxCell id="${link.id}" value="${xml(html(link.label))}" style="${xml(style)};" edge="1" parent="1" source="${xml(link.from.id)}" target="${xml(link.to.id)}">` +
    (bend
      ? `<mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="${bend.x}" y="${bend.y}" /></Array></mxGeometry>`
      : '<mxGeometry relative="1" as="geometry" />') +
    '</mxCell>'
  );
}

function port(
  prefix: 'exit' | 'entry',
  endpoint: Endpoint,
  leaves: Map<string, LeafNode>,
): string[] {
  if (!endpoint.position) return [];
  const [x, y] = POSITION_POINTS[endpoint.position];
  // A leaf's label hangs below its icon, so a line leaving from the bottom starts under the label
  const leaf = leaves.get(endpoint.id);
  const lines = leaf && leaf.label !== '' ? leaf.label.split('\n').length : 0;
  const dy = y === 1 && lines > 0 ? lines * LINE_HEIGHT + 4 : 0;
  return [`${prefix}X=${x}`, `${prefix}Y=${y}`, `${prefix}Dx=0`, `${prefix}Dy=${dy}`];
}

function html(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br>');
}

function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
