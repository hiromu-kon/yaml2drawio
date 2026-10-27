import { describe, expect, it } from 'vitest';
import { layoutDiagram, type Layout, type Rect } from '../src/layout.ts';
import type { Diagram, Link } from '../src/model.ts';
import { bendPoints, routeContext } from '../src/route.ts';
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
  return bendPoints(link, routeContext(diagram.root, layout));
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
