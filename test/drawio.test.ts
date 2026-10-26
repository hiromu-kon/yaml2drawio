import { describe, expect, it } from 'vitest';
import { toDrawio } from '../src/drawio.ts';
import { layoutDiagram } from '../src/layout.ts';
import { load } from './helpers.ts';

function render(source: string): string {
  const diagram = load(source);
  return toDrawio(diagram, layoutDiagram(diagram.root));
}

function cellTag(xml: string, id: string): string {
  const match = new RegExp(`<mxCell id="${id}"[^>]*>(<mxGeometry[^>]*>)?`).exec(xml);
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

  it('produces the same file for the same input', () => {
    expect(render(NESTED)).toBe(render(NESTED));
  });
});
