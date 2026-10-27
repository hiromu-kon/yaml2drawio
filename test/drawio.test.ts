import { describe, expect, it } from 'vitest';
import { toDrawio } from '../src/drawio.ts';
import { layoutDiagram } from '../src/layout.ts';
import { load } from './helpers.ts';

function render(source: string): string {
  const diagram = load(source);
  return toDrawio(diagram, layoutDiagram(diagram.root));
}

function cellTag(xml: string, id: string): string {
  const match = new RegExp(`<mxCell id="${id}"[^>]*>.*?</mxCell>`).exec(xml);
  if (!match) throw new Error(`no cell "${id}"`);
  return match[0];
}

const NESTED = [
  'nodes:',
  '  - group: aws.vpc',
  '    id: vpc',
  '    children:',
  '      - { id: fn, icon: aws.lambda }',
  '      - { id: queue, icon: aws.sqs, label: Orders & <Jobs> }',
  'links:',
  '  - [fn.s, queue.n]',
  '  - { from: fn.e, to: queue.w, style: dashed }',
  '',
].join('\n');

describe('toDrawio', () => {
  it('nests a cell under its group with coordinates relative to the group', () => {
    const diagram = load(NESTED);
    const layout = layoutDiagram(diagram.root);
    const rects = new Map([...layout.cells].map(([node, rect]) => [node.id, rect]));
    const vpc = rects.get('vpc');
    const fn = rects.get('fn');
    if (!vpc || !fn) throw new Error('missing cells');

    const tag = cellTag(toDrawio(diagram, layout), 'fn');
    expect(tag).toContain('parent="vpc"');
    expect(tag).toContain(`<mxGeometry x="${fn.x - vpc.x}" y="${fn.y - vpc.y}" `);
  });

  it('uses the draw.io style from the icon catalog', () => {
    expect(cellTag(render(NESTED), 'fn')).toContain('resIcon=mxgraph.aws4.lambda');
  });

  it('sets exit and entry points from link positions', () => {
    const tag = cellTag(render(NESTED), 'link-2');
    expect(tag).toContain('exitX=1;exitY=0.5;');
    expect(tag).toContain('entryX=0;entryY=0.5;');
    expect(tag).toContain('dashed=1');
  });

  it('starts a line leaving the bottom of an icon below its label', () => {
    expect(cellTag(render(NESTED), 'link-1')).toContain('exitX=0.5;exitY=1;exitDx=0;exitDy=19;');
  });

  it('escapes labels', () => {
    expect(cellTag(render(NESTED), 'queue')).toContain(
      'value="Orders &amp;amp; &amp;lt;Jobs&amp;gt;"',
    );
  });

  it('nests a border child under its group', () => {
    const xml = render(
      [
        'nodes:',
        '  - group: aws.vpc',
        '    id: vpc',
        '    border:',
        '      n: { id: igw, icon: aws.igw }',
        '    children:',
        '      - { id: fn, icon: aws.lambda }',
        '',
      ].join('\n'),
    );
    expect(cellTag(xml, 'igw')).toContain('parent="vpc"');
  });

  const ACROSS_GROUPS = [
    'direction: vertical',
    'nodes:',
    '  - { id: alb, icon: aws.alb }',
    '  - group: aws.private_subnet',
    '    id: subnet',
    '    children:',
    '      - { id: api, icon: aws.ecs }',
    '      - { id: worker, icon: aws.ecs }',
    'links:',
    '  - [alb.w, api.w]',
    '  - [api.e, worker.w]',
    '',
  ].join('\n');

  it('bends a line entering a leaf from the side just outside the group around the leaf', () => {
    const diagram = load(ACROSS_GROUPS);
    const layout = layoutDiagram(diagram.root);
    const subnet = [...layout.cells].find(([node]) => node.id === 'subnet')?.[1];
    if (!subnet) throw new Error('missing subnet');
    const xml = toDrawio(diagram, layout);
    expect(cellTag(xml, 'link-1')).toMatch(new RegExp(`<mxPoint x="${subnet.x - 12}" `));
  });

  it('does not bend a line between leaves in the same group', () => {
    expect(cellTag(render(ACROSS_GROUPS), 'link-2')).not.toContain('mxPoint');
  });

  it('puts the label of a border child on a left or right edge outside the group', () => {
    const xml = render(
      [
        'nodes:',
        '  - group: aws.vpc',
        '    border:',
        '      e: { id: endpoint, icon: aws.vpc_endpoint, label: Interface endpoints }',
        '    children: [{ id: fn, icon: aws.lambda }]',
        'links:',
        '  - [endpoint.s, fn.e]',
        '',
      ].join('\n'),
    );
    expect(cellTag(xml, 'endpoint')).toContain('labelPosition=right;');
    // the label is beside the icon, so a line from the bottom starts right at the icon
    expect(cellTag(xml, 'link-1')).toContain('exitY=1;exitDx=0;exitDy=0;');
  });

  it('produces the same file for the same input', () => {
    expect(render(NESTED)).toBe(render(NESTED));
  });

  it('starts the label of a short icon at the bottom of its square, and lines below it', () => {
    const xml = render(
      [
        'direction: vertical',
        'nodes:',
        '  - { id: router, icon: network.router, label: Router }',
        '  - { id: fw, icon: general.firewall }',
        'links:',
        '  - [router.s, fw.n]',
        '',
      ].join('\n'),
    );
    // A 48x14 router sits 17px above the bottom of its 48px square; the label drops by as much
    expect(cellTag(xml, 'router')).toContain('spacingTop=17;');
    expect(cellTag(xml, 'link-1')).toContain(`exitDy=${17 + 15 + 4};`);
  });
});
