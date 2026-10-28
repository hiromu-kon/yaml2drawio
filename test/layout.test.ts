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
    if (node.kind === 'empty') continue;
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

// A subnet with one icon under the given label, quoted so that \\n breaks the line
function subnet(label: string): string {
  return [
    'nodes:',
    '  - group: aws.private_subnet',
    '    id: app',
    `    label: "${label}"`,
    '    children: [{ id: api, icon: aws.ecs }]',
    '',
  ].join('\n');
}

// How far below the top of the subnet its icon starts
function contentTop(label: string): number {
  const layout = layoutDiagram(load(subnet(label)).root);
  return cellOf(layout, 'api').y - cellOf(layout, 'app').y;
}

function subnetWidth(label: string): number {
  return cellOf(layoutDiagram(load(subnet(label)).root), 'app').width;
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

  it('moves the content of a group with clear_label right of its label and keeps it centered', () => {
    const layout = layoutDiagram(
      load(
        [
          'nodes:',
          '  - group: aws.private_subnet',
          '    id: data',
          '    label: Data 10.1.20.0/24',
          '    clear_label: true',
          '    children:',
          '      - { id: db, icon: aws.aurora, label: DB }',
          '',
        ].join('\n'),
      ).root,
    );
    const data = cellOf(layout, 'data');
    const db = cellOf(layout, 'db');
    expect(db.x).toBeGreaterThan(data.x + 32 + textWidth('Data 10.1.20.0/24'));
    expect(db.x - data.x).toBe(data.x + data.width - (db.x + db.width));
  });

  it('clears the label of a group with clear_label for an icon inside a nested group', () => {
    const layout = layoutDiagram(
      load(
        [
          'nodes:',
          '  - group: aws.vpc',
          '    id: vpc',
          '    label: A rather long VPC label',
          '    clear_label: true',
          '    children:',
          '      - group: aws.security_group',
          '        label: SG',
          '        children:',
          '          - { id: api, icon: aws.ecs, label: API }',
          '',
        ].join('\n'),
      ).root,
    );
    const vpc = cellOf(layout, 'vpc');
    expect(cellOf(layout, 'api').x).toBeGreaterThan(
      vpc.x + 32 + textWidth('A rather long VPC label'),
    );
  });

  it('lines up an icon with the column of a longer row, after an empty slot', () => {
    // The NAT gateway sits over the second task, not halfway between the two
    const layout = layoutDiagram(
      load(
        [
          'direction: vertical',
          'nodes:',
          '  - group: aws.public_subnet',
          '    children:',
          '      - { empty: true }',
          '      - { id: nat, icon: aws.nat_gateway }',
          '  - group: aws.private_subnet',
          '    children:',
          '      - { id: worker, icon: aws.ecs }',
          '      - { id: api, icon: aws.ecs }',
          '',
        ].join('\n'),
      ).root,
    );
    const nat = cellOf(layout, 'nat');
    const api = cellOf(layout, 'api');
    expect(nat.x + nat.width / 2).toBe(api.x + api.width / 2);
  });

  it('pushes the content down a line for each further line of a group label', () => {
    expect(contentTop('App\\n10.0.10.0/24') - contentTop('App 10.0.10.0/24')).toBe(15);
    expect(
      contentTop('App\\n10.0.10.0/24\\nap-northeast-1a') - contentTop('App 10.0.10.0/24'),
    ).toBe(30);
  });

  it('measures a group label of two lines by its longer line', () => {
    expect(subnetWidth('Data 10.0.20.0/24 with a long name')).toBeGreaterThan(
      subnetWidth('Data\\n10.0.20.0/24 with a long name'),
    );
  });

  it('lines up leaves in rows stacked in the same column', () => {
    const layout = layoutDiagram(
      load(
        [
          'nodes:',
          '  - group: aws.az',
          '    direction: vertical',
          '    align: expand',
          '    children:',
          '      - group: aws.private_subnet',
          '        children:',
          '          - { id: worker, icon: aws.ecs, label: ECS Worker }',
          '          - { id: api, icon: aws.ecs, label: ECS API }',
          '      - group: aws.private_subnet',
          '        children:',
          '          - { id: redis, icon: aws.redis, label: Redis Primary }',
          '          - { id: aurora, icon: aws.aurora_instance, label: Aurora Writer }',
          '',
        ].join('\n'),
      ).root,
    );
    expect(cellOf(layout, 'worker').x).toBe(cellOf(layout, 'redis').x);
    expect(cellOf(layout, 'api').x).toBe(cellOf(layout, 'aurora').x);
  });

  it('leaves room for border labels only on the side that has them', () => {
    // The endpoint's label sits beyond the right edge, so the neighbor on the left stays close
    const layout = layoutDiagram(
      load(
        [
          'nodes:',
          '  - { id: neighbor, icon: aws.sqs }',
          '  - group: aws.vpc',
          '    id: vpc',
          '    border:',
          '      e: { id: endpoint, icon: aws.vpc_endpoint, label: Interface endpoints }',
          '    children: [{ id: fn, icon: aws.lambda }]',
          '',
        ].join('\n'),
      ).root,
    );
    const neighbor = cellOf(layout, 'neighbor');
    expect(cellOf(layout, 'vpc').x - (neighbor.x + neighbor.width)).toBeLessThan(
      textWidth('Interface endpoints'),
    );
  });

  it('leaves room beside a group for the label of a border child on its right edge', () => {
    const layout = layoutDiagram(
      load(
        [
          'nodes:',
          '  - group: aws.vpc',
          '    border:',
          '      e: { id: endpoint, icon: aws.vpc_endpoint, label: Interface endpoints }',
          '    children: [{ id: fn, icon: aws.lambda }]',
          '  - { id: neighbor, icon: aws.sqs }',
          '',
        ].join('\n'),
      ).root,
    );
    const endpoint = cellOf(layout, 'endpoint');
    const labelEnd = endpoint.x + endpoint.width + textWidth('Interface endpoints');
    expect(cellOf(layout, 'neighbor').x).toBeGreaterThan(labelEnd);
  });

  it('produces the same coordinates every time', () => {
    const source =
      'nodes:\n  - group: aws.vpc\n    children:\n      - { id: a, icon: aws.lambda }\n';
    const first = [...layoutDiagram(load(source).root).cells.values()];
    const second = [...layoutDiagram(load(source).root).cells.values()];
    expect(second).toEqual(first);
  });

  it('draws a group without children as tall as one holding an icon', () => {
    const diagram = load(
      [
        'nodes:',
        '  - group: aws.az',
        '    direction: vertical',
        '    align: expand',
        '    children:',
        '      - group: aws.public_subnet',
        '        id: unused',
        '        label: Public 10.0.1.0/24',
        '      - group: aws.private_subnet',
        '        id: app',
        '        children:',
        '          - { id: api, icon: aws.ecs, label: API service for orders }',
        '',
      ].join('\n'),
    );
    const layout = layoutDiagram(diagram.root);
    const unused = cellOf(layout, 'unused');
    expect(unused.width).toBe(cellOf(layout, 'app').width);
    expect(unused.width).toBeGreaterThan(textWidth('Public 10.0.1.0/24'));
    expect(unused.height).toBe(cellOf(layout, 'app').height);
  });

  it('fits a wide icon into the square every icon gets, keeping its proportions', () => {
    const diagram = load(
      [
        'nodes:',
        '  - { id: router, icon: network.router }',
        '  - { id: db, icon: general.database }',
        '',
      ].join('\n'),
    );
    const layout = layoutDiagram(diagram.root);
    const router = cellOf(layout, 'router');
    const db = cellOf(layout, 'db');
    // network.router is drawn 100 wide and 30 high in draw.io
    expect(router.width).toBe(48);
    expect(router.height).toBe(Math.round((48 * 30) / 100));
    expect(router.y + router.height / 2).toBeCloseTo(db.y + db.height / 2, 0);
  });
});
