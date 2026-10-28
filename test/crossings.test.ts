import { describe, expect, it } from 'vitest';
import { findCrossings, linkText } from '../src/crossings.ts';
import { layoutDiagram } from '../src/layout.ts';
import { formatProblem } from '../src/load.ts';
import { load } from './helpers.ts';

function crossingsOf(...lines: string[]): string[] {
  const diagram = load(lines.join('\n'));
  return findCrossings(diagram, layoutDiagram(diagram.root)).crossings.map((problem) =>
    formatProblem(problem),
  );
}

describe('findCrossings', () => {
  it('passes a line from above into the side of an icon, which turns before the labels', () => {
    expect(
      crossingsOf(
        'direction: vertical',
        'nodes:',
        '  - { id: alb, icon: aws.alb }',
        '  - group: aws.az',
        '    label: Availability Zone A',
        '    children:',
        '      - group: aws.private_subnet',
        '        label: Private subnet 10.0.10.0/24',
        '        children:',
        '          - { id: api, icon: aws.ecs }',
        '          - { id: worker, icon: aws.ecs }',
        '          - { id: batch, icon: aws.ecs }',
        'links:',
        '  - [alb.s, api.w]',
      ),
    ).toEqual([]);
  });

  it('reports a line into an icon right under the label of its subnet, at the link', () => {
    expect(
      crossingsOf(
        'direction: vertical',
        'nodes:',
        '  - { id: app, icon: aws.ecs }',
        '  - group: aws.private_subnet',
        '    label: Data 10.0.20.0/24',
        '    children:',
        '      - { id: db, icon: aws.aurora }',
        'links:',
        '  - [app.s, db.n]',
      ),
    ).toEqual(['9:5: link app.s -> db.n crosses the label of "Data 10.0.20.0/24"']);
  });

  it('knows that groups without an icon center their label', () => {
    expect(
      crossingsOf(
        'direction: vertical',
        'nodes:',
        '  - { id: users, icon: aws.users }',
        '  - group: aws.generic',
        '    label: Edge',
        '    children:',
        '      - { id: dns, icon: aws.route_53 }',
        '      - { id: cdn, icon: aws.cloudfront }',
        'links:',
        '  - [users.s, dns.n]',
      ),
    ).toEqual([]);
  });

  it('reports a line over an icon between its ends', () => {
    expect(
      crossingsOf(
        'nodes:',
        '  - { id: a, icon: aws.lambda }',
        '  - { id: b, icon: aws.sqs }',
        '  - { id: c, icon: aws.s3 }',
        'links:',
        '  - [a.e, c.w]',
      ),
    ).toEqual(['6:5: link a.e -> c.w crosses the icon of "b"']);
  });

  it('lets a line touch the icons and labels at its own ends', () => {
    expect(
      crossingsOf(
        'direction: vertical',
        'nodes:',
        '  - { id: a, icon: aws.lambda, label: A long label under the icon }',
        '  - { id: b, icon: aws.sqs, label: Another long label }',
        'links:',
        '  - [a.s, b.n]',
        '  - [b.e, a.e]',
      ),
    ).toEqual([]);
  });

  it('checks a line to the side of a group', () => {
    expect(
      crossingsOf(
        'nodes:',
        '  - { id: office, icon: aws.corporate_data_center }',
        '  - { id: router, icon: aws.vpn_gateway }',
        '  - group: aws.vpc',
        '    id: vpc',
        '    children: [{ id: api, icon: aws.ecs }]',
        'links:',
        '  - [office.e, vpc.w]',
      ),
    ).toEqual(['8:5: link office.e -> vpc.w crosses the icon of "router"']);
  });

  it('reports lines from different icons that join into one point, at the later link', () => {
    expect(
      crossingsOf(
        'nodes:',
        '  - column:',
        '      - { id: deploy, icon: aws.codedeploy }',
        '      - { id: registry, icon: aws.ecr }',
        '  - { id: app, icon: aws.ecs }',
        'links:',
        '  - [deploy.e, app.w]',
        '  - [registry.e, app.w]',
      ),
    ).toEqual(['8:5: link registry.e -> app.w runs along link deploy.e -> app.w']);
  });

  it('reports a dashed line that leaves along a solid one, which hides its dashes', () => {
    expect(
      crossingsOf(
        'nodes:',
        '  - { id: cdn, icon: aws.cloudfront }',
        '  - column:',
        '      - { id: primary, icon: aws.alb }',
        '      - { id: standby, icon: aws.alb }',
        'links:',
        '  - [cdn.e, primary.w]',
        '  - { from: cdn.e, to: standby.w, style: dashed }',
      ),
    ).toEqual(['8:5: link cdn.e -> standby.w runs along link cdn.e -> primary.w']);
  });

  it('passes lines drawn alike that leave one point together and split, like branches', () => {
    expect(
      crossingsOf(
        'nodes:',
        '  - { id: cdn, icon: aws.cloudfront }',
        '  - column:',
        '      - { id: site, icon: aws.alb }',
        '      - { id: assets, icon: aws.s3 }',
        'links:',
        '  - [cdn.e, site.w]',
        '  - [cdn.e, assets.w]',
      ),
    ).toEqual([]);
  });

  it('lists lines whose ends float as unchecked, because draw.io picks their sides', () => {
    const diagram = load(
      [
        'nodes:',
        '  - { id: a, icon: aws.lambda }',
        '  - { id: b, icon: aws.sqs }',
        '  - { id: c, icon: aws.s3 }',
        'links:',
        '  - [a, c]',
        '  - [a.e, b]',
      ].join('\n'),
    );
    const { crossings, unchecked } = findCrossings(diagram, layoutDiagram(diagram.root));
    expect(crossings).toEqual([]);
    expect(unchecked.map(linkText)).toEqual(['a -> c', 'a.e -> b']);
  });

  it.each([
    ['auto', []],
    ['drawio', ['11:5: link a.s -> c.s crosses the label of "b"']],
  ])('follows the route draw.io takes with route: %s', (route, expected) => {
    expect(
      crossingsOf(
        'nodes:',
        '  - group: aws.private_subnet',
        '    children:',
        '      - { id: a, icon: aws.lambda }',
        '      - { id: b, icon: aws.sqs, label: "Queue\\nfor jobs" }',
        '  - group: aws.private_subnet',
        '    children:',
        '      - { id: c, icon: aws.s3 }',
        'links:',
        '  # draw.io turns just below the icons; the bends of auto pass below the subnets',
        `  - { from: a.s, to: c.s, route: ${route} }`,
      ),
    ).toEqual(expected);
  });
});
