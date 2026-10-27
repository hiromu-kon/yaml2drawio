import { describe, expect, it } from 'vitest';
import { GROUP_PADDING, layoutDiagram, type Layout, type Rect } from '../src/layout.ts';
import type { Diagram, Link } from '../src/model.ts';
import { bendPoints, entryShift, routeContext } from '../src/route.ts';
import { load } from './helpers.ts';

function setUp(source: string): { diagram: Diagram; layout: Layout; rect: (id: string) => Rect } {
  const diagram = load(source);
  const layout = layoutDiagram(diagram.root);
  const rect = (id: string) => {
    for (const [node, r] of layout.cells) if (node.id === id) return r;
    throw new Error(`no cell "${id}"`);
  };
  return { diagram, layout, rect };
}

function bendsOf(diagram: Diagram, layout: Layout, index: number) {
  const link: Link | undefined = diagram.links[index];
  if (!link) throw new Error(`no link ${index}`);
  return bendPoints(link, routeContext(diagram.root, layout, diagram.links));
}

describe('bendPoints', () => {
  it('turns a downward line in the gap just below the group it leaves', () => {
    const { diagram, layout, rect } = setUp(
      [
        'direction: vertical',
        'nodes:',
        '  - group: aws.generic',
        '    id: edge',
        '    children:',
        '      - { id: cdn, icon: aws.cloudfront }',
        '      - { id: s3, icon: aws.s3 }',
        '  - { id: alb, icon: aws.alb }',
        'links:',
        '  - [cdn.s, alb.n]',
        '',
      ].join('\n'),
    );
    const edge = rect('edge');
    const bends = bendsOf(diagram, layout, 0);
    expect(bends.map((point) => point.y)).toEqual([
      edge.y + edge.height + 12,
      edge.y + edge.height + 12,
    ]);
  });

  it('leaves a line between leaves of the same group to draw.io', () => {
    const { diagram, layout } = setUp(
      [
        'nodes:',
        '  - group: aws.generic',
        '    direction: vertical',
        '    children:',
        '      - { id: build, icon: aws.codebuild }',
        '      - { id: commit, icon: aws.codecommit }',
        'links:',
        '  - [commit.n, build.s]',
        '',
      ].join('\n'),
    );
    expect(bendsOf(diagram, layout, 0)).toEqual([]);
  });

  it('bends a line entering from the side outside the outermost group it enters', () => {
    // Bending just outside the security group would run the line through the subnet's label
    const { diagram, layout, rect } = setUp(
      [
        'direction: vertical',
        'nodes:',
        '  - { id: alb, icon: aws.alb }',
        '  - group: aws.az',
        '    id: az',
        '    children:',
        '      - group: aws.private_subnet',
        '        children:',
        '          - group: aws.security_group',
        '            children:',
        '              - { id: api, icon: aws.ecs }',
        'links:',
        '  - [alb.w, api.w]',
        '',
      ].join('\n'),
    );
    const api = rect('api');
    expect(bendsOf(diagram, layout, 0)).toEqual([
      { x: rect('az').x - GROUP_PADDING / 2, y: api.y + api.height / 2 },
    ]);
  });

  it('turns a line from a bottom side in the gap above the group it then runs down beside', () => {
    const { diagram, layout, rect } = setUp(
      [
        'direction: vertical',
        'nodes:',
        '  - { id: alb, icon: aws.alb }',
        '  - group: aws.az',
        '    id: az',
        '    children:',
        '      - group: aws.private_subnet',
        '        children:',
        '          - { id: api, icon: aws.ecs }',
        '          - { id: worker, icon: aws.ecs }',
        'links:',
        '  - [alb.s, api.w]',
        '',
      ].join('\n'),
    );
    const alb = rect('alb');
    const az = rect('az');
    const api = rect('api');
    const x = az.x - GROUP_PADDING / 2;
    const y = az.y - GROUP_PADDING / 2;
    expect(bendsOf(diagram, layout, 0)).toEqual([
      { x: Math.round(alb.x + alb.width / 2), y },
      { x, y },
      { x, y: api.y + api.height / 2 },
    ]);
  });

  it('bends a later line inside the outer group when outside it would run along an earlier one', () => {
    const { diagram, layout, rect } = setUp(
      [
        'nodes:',
        '  - column:',
        '      - { id: deploy, icon: aws.codedeploy }',
        '      - { id: registry, icon: aws.ecr }',
        '  - group: aws.vpc',
        '    id: vpc',
        '    children:',
        '      - group: aws.private_subnet',
        '        id: subnet',
        '        children:',
        '          - { id: app, icon: aws.ecs }',
        'links:',
        '  - [registry.e, app.w]',
        '  - [deploy.e, app.wsw]',
        '',
      ].join('\n'),
    );
    expect(bendsOf(diagram, layout, 0)[0]?.x).toBe(rect('vpc').x - GROUP_PADDING / 2);
    expect(bendsOf(diagram, layout, 1)[0]?.x).toBe(rect('subnet').x - GROUP_PADDING / 2);
  });

  it('bends inside the outer group when bending outside it would turn the line back', () => {
    // The ALB sits over the gap between the AZs, so outside the AZ is behind its right side
    const { diagram, layout, rect } = setUp(
      [
        'direction: vertical',
        'nodes:',
        '  - { id: alb, icon: aws.alb }',
        '  - row:',
        '      - group: aws.az',
        '        children:',
        '          - group: aws.private_subnet',
        '            children: [{ id: api_a, icon: aws.ecs }]',
        '      - group: aws.az',
        '        id: az_c',
        '        children:',
        '          - group: aws.private_subnet',
        '            id: subnet_c',
        '            children: [{ id: api_c, icon: aws.ecs }]',
        'links:',
        '  - [alb.e, api_c.w]',
        '',
      ].join('\n'),
    );
    const alb = rect('alb');
    expect(rect('az_c').x - GROUP_PADDING / 2).toBeLessThan(alb.x + alb.width);
    const api = rect('api_c');
    expect(bendsOf(diagram, layout, 0)).toEqual([
      { x: rect('subnet_c').x - GROUP_PADDING / 2, y: api.y + api.height / 2 },
    ]);
  });

  it('turns all lines fanning out from one point at the same height', () => {
    // The router is shorter than the database, so halfway to each target would differ
    const { diagram, layout } = setUp(
      [
        'direction: vertical',
        'nodes:',
        '  - { id: users, icon: general.users }',
        '  - row:',
        '      - group: general.generic',
        '        children: [{ id: router, icon: network.router }]',
        '      - group: general.generic',
        '        children: [{ id: db, icon: general.database }]',
        'links:',
        '  - [users.s, router.n]',
        '  - [users.s, db.n]',
        '',
      ].join('\n'),
    );
    const [first, second] = [bendsOf(diagram, layout, 0), bendsOf(diagram, layout, 1)];
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(new Set([...first, ...second].map(({ y }) => y)).size).toBe(1);
  });

  it('turns fans that cross the same stretch at different heights', () => {
    const { diagram, layout } = setUp(
      [
        'direction: vertical',
        'nodes:',
        '  - row:',
        '      - { id: web, icon: general.users }',
        '      - { id: mobile, icon: general.mobile }',
        '  - group: general.generic',
        '    children:',
        '      - { id: a, icon: aws.route_53 }',
        '      - { id: b, icon: aws.cognito }',
        '      - { id: c, icon: aws.cloudfront }',
        'links:',
        '  - [web.s, a.n]',
        '  - [web.s, c.n]',
        '  - [mobile.s, b.n]',
        '  - [mobile.s, c.n]',
        '',
      ].join('\n'),
    );
    const heightOf = (index: number) => bendsOf(diagram, layout, index)[0]?.y;
    expect(heightOf(0)).toBe(heightOf(1));
    expect(heightOf(2)).toBe(heightOf(3));
    expect(heightOf(2)).toBeLessThan(heightOf(0) ?? 0);
  });

  const UNDER_THE_SOURCE = [
    'direction: vertical',
    'nodes:',
    '  - { id: alb, icon: aws.alb }',
    '  - group: aws.private_subnet',
    '    children:',
    '      - { id: api, icon: aws.ecs }',
    '      - { id: worker, icon: aws.ecs }',
    'links:',
    '  - [alb.e, api.w]',
    '',
  ].join('\n');

  it('does not bend a line behind the side it leaves from', () => {
    // api sits left of the ALB, so bending outside the subnet would turn the line back
    const { diagram, layout, rect } = setUp(UNDER_THE_SOURCE);
    expect(rect('api').x).toBeLessThan(rect('alb').x);
    expect(bendsOf(diagram, layout, 0)).toEqual([]);
  });

  it('leaves the whole route to draw.io with route: drawio', () => {
    const { diagram, layout } = setUp(
      [
        'direction: vertical',
        'nodes:',
        '  - group: aws.generic',
        '    children: [{ id: cdn, icon: aws.cloudfront }, { id: s3, icon: aws.s3 }]',
        '  - { id: alb, icon: aws.alb }',
        'links:',
        '  - [cdn.s, alb.n]',
        '  - { from: cdn.s, to: alb.n, route: drawio }',
        '',
      ].join('\n'),
    );
    expect(bendsOf(diagram, layout, 0)).not.toEqual([]);
    expect(bendsOf(diagram, layout, 1)).toEqual([]);
  });

  it('runs a bottom-to-bottom line below the groups that hold only one of its ends', () => {
    const { diagram, layout, rect } = setUp(
      [
        'nodes:',
        '  - group: aws.vpc',
        '    children:',
        '      - group: aws.az',
        '        id: az_a',
        '        children:',
        '          - group: aws.private_subnet',
        '            children: [{ id: primary, icon: aws.redis }]',
        '      - group: aws.az',
        '        id: az_c',
        '        children:',
        '          - group: aws.private_subnet',
        '            children: [{ id: replica, icon: aws.redis }]',
        'links:',
        '  - [primary.s, replica.s]',
        '',
      ].join('\n'),
    );
    const bottom = Math.max(...['az_a', 'az_c'].map((id) => rect(id).y + rect(id).height));
    expect(bendsOf(diagram, layout, 0).map((point) => point.y)).toEqual([bottom + 12, bottom + 12]);
  });
});

// An app beside a group holding a bucket
function storage(bucketColumn: string[]): string {
  return [
    'nodes:',
    '  - { id: app, icon: aws.ecs }',
    '  - group: aws.generic',
    '    children:',
    ...bucketColumn,
    'links:',
    '  - [app.e, bucket.w]',
    '',
  ].join('\n');
}

describe('entryShift', () => {
  it('moves the end along the side of an icon that is almost level, so the line runs straight', () => {
    // The group's header pushes the bucket a little below the app beside the group
    const { diagram, layout, rect } = setUp(storage(['      - { id: bucket, icon: aws.s3 }']));
    const offset = rect('app').y - rect('bucket').y;
    expect(offset).not.toBe(0);
    const [link] = diagram.links;
    if (!link) throw new Error('no link');
    expect(entryShift(link, routeContext(diagram.root, layout, diagram.links))).toEqual({
      x: 0,
      y: offset,
    });
    const middle = rect('app').y + rect('app').height / 2;
    expect(bendsOf(diagram, layout, 0).map((point) => point.y)).toEqual([middle]);
  });

  it('keeps the end in the middle when the icons are clearly apart', () => {
    const { diagram, layout } = setUp(
      storage([
        '      - column:',
        '          - { id: bucket, icon: aws.s3 }',
        '          - { id: logs, icon: aws.s3 }',
      ]),
    );
    const [link] = diagram.links;
    if (!link) throw new Error('no link');
    expect(entryShift(link, routeContext(diagram.root, layout, diagram.links))).toEqual({
      x: 0,
      y: 0,
    });
  });
});
