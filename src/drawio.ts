import { labelBelow, labelDrop, type Layout, type Rect } from './layout.ts';
import type { Diagram, DiagramNode, Endpoint, GroupNode, LeafNode, Link } from './model.ts';
import { POSITION_POINTS, sideOf } from './position.ts';
import { bendPoints, routeContext, type Point } from './route.ts';

// Each draw.io library styles its labels its own way (gray bold for Google Cloud, blue for network
// equipment), which looks patchy in a diagram that mixes them, and text.ts estimates widths for
// 12px regular text. Later keys win in a draw.io style, so this evens them out.
const LEAF_LABEL_STYLE =
  'fontColor=#232F3E;fontSize=12;fontStyle=0;verticalLabelPosition=bottom;verticalAlign=top;';

// Later keys win in a draw.io style, so these override the catalog's label-below placement. The
// label goes above the middle of the side, where lines to the outside usually leave.
const SIDE_LABEL_STYLE = {
  left: 'labelPosition=left;verticalLabelPosition=top;align=right;verticalAlign=bottom;spacingRight=4;',
  right:
    'labelPosition=right;verticalLabelPosition=top;align=left;verticalAlign=bottom;spacingLeft=4;',
} as const;

export function toDrawio(diagram: Diagram, layout: Layout): string {
  const cells: string[] = [];
  // How far below each icon its label ends; labels of side border children sit beside theirs
  const belowIcon = new Map<string, number>();

  const visit = (
    node: DiagramNode,
    parent: GroupNode | undefined,
    labelSide?: 'left' | 'right',
  ): void => {
    if (node.kind === 'stack') {
      for (const child of node.children) visit(child, parent);
      return;
    }
    const geometry = relativeTo(cellRect(layout, node), parent && cellRect(layout, parent));
    if (node.kind === 'leaf') {
      const drop = labelSide || node.label === '' ? 0 : labelDrop(node.shape);
      const base = withSemicolon(node.shape.style) + LEAF_LABEL_STYLE;
      const style = labelSide
        ? base + SIDE_LABEL_STYLE[labelSide]
        : drop > 0
          ? `${base}spacingTop=${drop};`
          : base;
      if (!labelSide && node.label !== '') {
        belowIcon.set(node.id, labelBelow(node));
      }
      cells.push(vertex(node.id, node.label, style, parent?.id, geometry));
      return;
    }
    cells.push(vertex(node.id, node.label, groupStyle(node.shape.style), parent?.id, geometry));
    for (const child of node.children) visit(child, node);
    // Border children belong to the group so that moving it in draw.io moves them too
    for (const { node: child, position } of node.border) {
      const side = sideOf(position);
      visit(child, node, side === 'left' || side === 'right' ? side : undefined);
    }
  };
  visit(diagram.root, undefined);

  const context = routeContext(diagram.root, layout, diagram.links);
  for (const link of diagram.links) {
    cells.push(edge(link, belowIcon, bendPoints(link, context)));
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

function withSemicolon(style: string): string {
  return style.endsWith(';') ? style : `${style};`;
}

function groupStyle(style: string): string {
  return style.includes('container=1') ? style : `${style}container=1;collapsible=0;`;
}

function edge(link: Link, belowIcon: Map<string, number>, bends: Point[]): string {
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
    ...port('exit', link.from, belowIcon),
    ...port('entry', link.to, belowIcon),
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
  belowIcon: Map<string, number>,
): string[] {
  if (!endpoint.position) return [];
  const [x, y] = POSITION_POINTS[endpoint.position];
  // A label below the icon would be crossed, so a line leaving from the bottom starts under it
  const dy = y === 1 ? (belowIcon.get(endpoint.id) ?? 0) : 0;
  const keys = [`${prefix}X=${x}`, `${prefix}Y=${y}`, `${prefix}Dx=0`, `${prefix}Dy=${dy}`];
  if (dy === 0) return keys;
  // draw.io moves a port onto the outline of the shape, which would pull it back above the label.
  // Off the outline, it no longer knows which side the port is on and may start the line sideways,
  // so the direction is given as well.
  const constraint = prefix === 'exit' ? 'sourcePortConstraint' : 'targetPortConstraint';
  return [...keys, `${prefix}Perimeter=0`, `${constraint}=south`];
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
