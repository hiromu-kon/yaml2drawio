import { describe, expect, it } from 'vitest';
import { layoutDiagram } from '../src/layout.ts';
import { load, problemsOf } from './helpers.ts';

const ALIGNED = `direction: vertical
nodes:
  - group: general.generic
    children:
      - {id: a, icon: aws.ecs}
      - {id: target, icon: aws.s3}
  - group: general.generic
    children:
      - {id: source, icon: aws.ecs, align_with: target}
`;

describe('align_with', () => {
  it('reports a misspelled axis key and invalid axis at their source locations', () => {
    const input =
      'nodes:\n  - {id: a, icon: aws.ecs, align_with: {id: b, axix: x}}\n  - {id: b, icon: aws.ecs}\n';
    expect(problemsOf(input).join('\n')).toContain('did you mean "axis"?');
    expect(problemsOf(input.replace('axix: x', 'axis: z')).join('\n')).toContain('2:');
  });
  it.each(['start', 'center', 'end', 'expand'])(
    'respects %s alignment while targeting either column',
    (align) => {
      for (const target of ['a', 'b']) {
        const diagram = load(`nodes:
  - column:
      - row:
          - {id: a, icon: aws.ecs}
          - {id: b, icon: aws.s3}
      - {id: source, icon: aws.ecs, align_with: ${target}}
    align: ${align}
`);
        const centers = new Map(
          [...layoutDiagram(diagram.root).cells].map(([node, rect]) => [
            node.id,
            rect.x + rect.width / 2,
          ]),
        );
        expect(centers.get('source')).toBe(centers.get(target));
      }
    },
  );
  it.each([false, true])('aligns icons across groups with a forward reference: %s', (forward) => {
    const source = forward
      ? ALIGNED.replace(
          /  - group: general.generic\n    children:\n      - \{id: a, icon: aws.ecs\}\n      - \{id: target, icon: aws.s3\}\n/,
          '',
        ) +
        '  - group: general.generic\n    children:\n      - {id: a, icon: aws.ecs}\n      - {id: target, icon: aws.s3}\n'
      : ALIGNED;
    const diagram = load(source);
    const layout = layoutDiagram(diagram.root);
    const centers = new Map(
      [...layout.cells].map(([node, rect]) => [node.id, rect.x + rect.width / 2]),
    );
    expect(centers.get('source')).toBe(centers.get('target'));
    for (const node of diagram.root.children) {
      if (node.kind !== 'group') throw new Error('expected a group');
      const outer = layout.cells.get(node)!;
      for (const child of node.children) {
        if (child.kind !== 'leaf') throw new Error('expected an icon');
        const rect = layout.cells.get(child)!;
        expect(rect.x).toBeGreaterThanOrEqual(outer.x + 24);
        expect(rect.x + rect.width).toBeLessThanOrEqual(outer.x + outer.width - 24);
      }
    }
    expect(layoutDiagram(diagram.root)).toEqual(layout);
  });

  it('follows a chain of alignments', () => {
    const diagram = load(`direction: vertical
nodes:
  - row:
      - {id: a, icon: aws.ecs}
      - {id: target, icon: aws.s3}
  - {id: middle, icon: aws.s3, align_with: target}
  - {id: source, icon: aws.ecs, align_with: middle}
`);
    const centers = [...layoutDiagram(diagram.root).cells]
      .filter(([node]) => ['target', 'middle', 'source'].includes(node.id))
      .map(([, rect]) => rect.x + rect.width / 2);
    expect(new Set(centers).size).toBe(1);
  });

  it.each([
    ['missing', 'nodes:\n  - {id: a, icon: aws.ecs, align_with: missing}\n', 'not one'],
    [
      'group',
      'nodes:\n  - {id: a, icon: aws.ecs, align_with: vpc}\n  - {id: vpc, group: aws.vpc}\n',
      'not one',
    ],
    ['self reference', 'nodes:\n  - {id: a, icon: aws.ecs, align_with: a}\n', 'circular'],
    [
      'cycle',
      'nodes:\n  - {id: a, icon: aws.ecs, align_with: b}\n  - {id: b, icon: aws.ecs, align_with: a}\n',
      'circular',
    ],
    [
      'border source',
      'nodes:\n  - group: aws.vpc\n    border:\n      n: {id: a, icon: aws.ecs, align_with: b}\n    children: [{id: b, icon: aws.ecs}]\n',
      'border',
    ],
    [
      'border target',
      'nodes:\n  - group: aws.vpc\n    border:\n      n: {id: a, icon: aws.ecs}\n    children: [{id: b, icon: aws.ecs, align_with: a}]\n',
      'border',
    ],
  ])('rejects an invalid %s with its location', (_, input, message) => {
    expect(problemsOf(input).join('\n')).toMatch(new RegExp(`\\d+:\\d+: .*${message}`));
  });

  it('rejects explicit x alignment between icons ordered left to right', () => {
    const diagram = load(
      'nodes:\n  - {id: a, icon: aws.ecs, align_with: {id: b, axis: x}}\n  - {id: b, icon: aws.ecs}\n',
    );
    expect(() => layoutDiagram(diagram.root)).toThrow(
      'axis x conflicts with the horizontal ordering',
    );
  });

  it.each(['start', 'center', 'end', 'expand'])(
    'aligns heights across groups with %s alignment',
    (align) => {
      for (const explicit of [false, true]) {
        const diagram = load(`nodes:
  - row:
      - group: general.generic
        direction: vertical
        children:
          - {id: a, icon: aws.ecs}
          - {id: target, icon: aws.s3}
      - group: general.generic
        children:
          - {id: source, icon: network.router, align_with: ${explicit ? '{id: target, axis: y}' : 'target'}}
    align: ${align}
`);
        const layout = layoutDiagram(diagram.root);
        const centers = new Map(
          [...layout.cells].map(([node, rect]) => [node.id, rect.y + rect.height / 2]),
        );
        expect(centers.get('source')).toBe(centers.get('target'));
      }
    },
  );

  it('rejects explicit y alignment between icons ordered top to bottom', () => {
    const diagram = load(
      'direction: vertical\nnodes:\n  - {id: a, icon: aws.ecs, align_with: {id: b, axis: y}}\n  - {id: b, icon: aws.ecs}\n',
    );
    expect(() => layoutDiagram(diagram.root)).toThrow(
      'axis y conflicts with the vertical ordering',
    );
  });

  it('rejects contradictory ordering without producing an overlapping layout', () => {
    const diagram = load(`direction: vertical
nodes:
  - row:
      - {id: a, icon: aws.ecs}
      - {id: b, icon: aws.ecs}
  - row:
      - {id: c, icon: aws.ecs, align_with: b}
      - {id: d, icon: aws.ecs, align_with: a}
`);
    expect(() => layoutDiagram(diagram.root)).toThrow('cannot be satisfied');
  });
});
