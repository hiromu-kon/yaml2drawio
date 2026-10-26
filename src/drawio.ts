import type { Layout, Rect } from './layout.ts';
import type { Diagram, DiagramNode, Endpoint, GroupNode, LeafNode, Link } from './model.ts';
import { POSITION_POINTS } from './position.ts';
import { bendPoints, routeContext, type Point } from './route.ts';
import { LINE_HEIGHT } from './text.ts';

export function toDrawio(diagram: Diagram, layout: Layout): string {
  const cells: string[] = [];

  const visit = (node: DiagramNode, parent: GroupNode | undefined): void => {
    if (node.kind === 'stack') {
      for (const child of node.children) visit(child, parent);
      return;
    }
    const geometry = relativeTo(cellRect(layout, node), parent && cellRect(layout, parent));
    if (node.kind === 'leaf') {
      cells.push(vertex(node.id, node.label, node.shape.style, parent?.id, geometry));
      return;
    }
    cells.push(vertex(node.id, node.label, groupStyle(node.shape.style), parent?.id, geometry));
    for (const child of node.children) visit(child, node);
    // Border children belong to the group so that moving it in draw.io moves them too
    for (const { node: child } of node.border) visit(child, node);
  };
  visit(diagram.root, undefined);

  const context = routeContext(diagram.root, layout);
  for (const link of diagram.links) {
    cells.push(edge(link, context.leaves, bendPoints(link, context)));
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

function edge(link: Link, leaves: Map<string, LeafNode>, bends: Point[]): string {
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
    (bends.length > 0
      ? `<mxGeometry relative="1" as="geometry"><Array as="points">${bends.map(({ x, y }) => `<mxPoint x="${x}" y="${y}" />`).join('')}</Array></mxGeometry>`
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
