import { describe, expect, it } from 'vitest';
import { layoutDiagram, type Layout, type Rect } from '../src/layout.ts';
import type { DiagramNode, GroupNode, LeafNode } from '../src/model.ts';
import { textWidth } from '../src/text.ts';
import { load } from './helpers.ts';

function cellOf(layout: Layout, id: string): Rect {
  for (const [node, rect] of layout.cells) if (node.id === id) return rect;
  throw new Error(`no cell "${id}"`);
}

function findNode(nodes: DiagramNode[], id: string): LeafNode | GroupNode | undefined {
  for (const node of nodes) {
    if (node.kind !== 'stack' && node.id === id) return node;
    if (node.kind !== 'leaf') {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function vpcWithBorder(border: string): string {
  return [
    'direction: vertical',
    'nodes:',
    '  - { id: above, icon: aws.users }',
    '  - group: aws.vpc',
    '    id: vpc',
    '    direction: vertical',
    '    border:',
    border,
    '    children:',
    '      - { id: alb, icon: aws.alb }',
    '',
  ].join('\n');
}

describe('layoutDiagram', () => {
  it('places the children of a row left to right without overlapping', () => {
    const diagram = load(
      'nodes:\n  - row:\n      - { id: a, icon: aws.lambda }\n      - { id: b, icon: aws.sqs, label: A long label }\n',
    );
    const layout = layoutDiagram(diagram.root);
    const a = cellOf(layout, 'a');
    const b = cellOf(layout, 'b');
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(a.y).toBe(b.y);
  });

  it('places the children of a vertical group top to bottom inside the group', () => {
    const diagram = load(
      [
        'nodes:',
        '  - group: aws.vpc',
        '    id: vpc',
        '    direction: vertical',
        '    children:',
        '      - { id: a, icon: aws.lambda }',
        '      - { id: b, icon: aws.sqs }',
        '',
      ].join('\n'),
    );
    const layout = layoutDiagram(diagram.root);
    const vpc = cellOf(layout, 'vpc');
    const a = cellOf(layout, 'a');
    const b = cellOf(layout, 'b');
    expect(a.y + a.height).toBeLessThan(b.y);
    expect(contains(vpc, a)).toBe(true);
    expect(contains(vpc, b)).toBe(true);
  });

  it('gives the children of a vertical group the same width with align: expand', () => {
    const diagram = load(
      [
        'nodes:',
        '  - group: aws.az',
        '    direction: vertical',
        '    align: expand',
        '    children:',
        '      - group: aws.private_subnet',
        '        id: narrow',
        '        children: [{ id: a, icon: aws.lambda }]',
        '      - group: aws.private_subnet',
        '        id: wide',
        '        children: [{ id: b, icon: aws.sqs, label: A very long label for width }]',
        '',
      ].join('\n'),
    );
    const layout = layoutDiagram(diagram.root);
    expect(cellOf(layout, 'narrow').width).toBe(cellOf(layout, 'wide').width);
  });

  it('reserves room below an icon for its label', () => {
    const diagram = load(
      'direction: vertical\nnodes:\n  - { id: a, icon: aws.lambda, label: "Line 1\\nLine 2" }\n  - { id: b, icon: aws.sqs }\n',
    );
    const layout = layoutDiagram(diagram.root);
    const a = cellOf(layout, 'a');
    // two label lines (15px each) and the gap must fit between the icons
    expect(cellOf(layout, 'b').y - (a.y + a.height)).toBeGreaterThanOrEqual(34);
    expect(findNode(diagram.root.children, 'a')).toMatchObject({ label: 'Line 1\nLine 2' });
  });

  it('centers a border child on its edge of the group', () => {
    const layout = layoutDiagram(load(vpcWithBorder('      n: { id: igw, icon: aws.igw }')).root);
    const vpc = cellOf(layout, 'vpc');
    const igw = cellOf(layout, 'igw');
    expect(igw.y + igw.height / 2).toBe(vpc.y);
    expect(igw.x + igw.width / 2).toBe(vpc.x + vpc.width / 2);
  });

  it('keeps the content and the neighbors clear of a border child', () => {
    const layout = layoutDiagram(
      load(vpcWithBorder('      n: { id: igw, icon: aws.igw, label: IGW }')).root,
    );
    const igw = cellOf(layout, 'igw');
    const labelBottom = igw.y + igw.height + 19;
    expect(cellOf(layout, 'alb').y).toBeGreaterThan(labelBottom);
    const above = cellOf(layout, 'above');
    expect(above.y + above.height).toBeLessThan(igw.y);
  });

  it('keeps the content centered under the top edge when only one side has a border child', () => {
    const layout = layoutDiagram(
      load(
        vpcWithBorder(
          '      n: { id: igw, icon: aws.igw }\n      e: { id: endpoint, icon: aws.vpc_endpoint }',
        ),
      ).root,
    );
    const igw = cellOf(layout, 'igw');
    const alb = cellOf(layout, 'alb');
    expect(alb.x + alb.width / 2).toBe(igw.x + igw.width / 2);
  });

  it('widens a group so a border child on its top edge starts right of the group label', () => {
    const layout = layoutDiagram(
      load(
        vpcWithBorder('      n: { id: igw, icon: aws.igw }').replace(
          'id: vpc',
          'id: vpc\n    label: A rather long VPC label',
        ),
      ).root,
    );
    const vpc = cellOf(layout, 'vpc');
    const labelEnd = vpc.x + 32 + textWidth('A rather long VPC label');
    expect(cellOf(layout, 'igw').x).toBeGreaterThan(labelEnd);
  });

  it('produces the same coordinates every time', () => {
    const source =
      'nodes:\n  - group: aws.vpc\n    children:\n      - { id: a, icon: aws.lambda }\n';
    const first = [...layoutDiagram(load(source).root).cells.values()];
    const second = [...layoutDiagram(load(source).root).cells.values()];
    expect(second).toEqual(first);
  });
});
