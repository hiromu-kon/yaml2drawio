import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutDiagram } from '../src/layout.ts';
import { findCrossings } from '../src/crossings.ts';
import { predictPath, routeContext, segmentsOf } from '../src/route.ts';
import { toDrawio } from '../src/drawio.ts';
import { load, problemsOf } from './helpers.ts';
import { readImage } from '../src/image.ts';

describe('post-release behavior regressions', () => {
  it.each(['source', 'target'])(
    'resolves a one-pixel nested alignment when %s references the other icon',
    (reference) => {
      const text = `direction: vertical
nodes:
  - align: start
    column:
      - {id: wide_a, icon: general.application, label: Provisioning service for customer-facing applications}
      - {id: source, icon: general.application, label: SOURCE${reference === 'source' ? ', align_with: target' : ''}}
  - align: start
    column:
      - {id: wide_b, icon: general.application, label: Provisioning service for customer-facing applications}
      - {id: target, icon: general.application, label: Target${reference === 'target' ? ', align_with: source' : ''}}
`;
      const diagram = load(text),
        layout = layoutDiagram(diagram.root);
      const centers = new Map(
        [...layout.cells].map(([node, rect]) => [node.id, rect.x + rect.width / 2]),
      );
      expect(centers.get('source')).toBe(centers.get('target'));
      const baseline = load(text.replace(/, align_with: (target|source)/, ''));
      expect(layout.width).toBe(layoutDiagram(baseline.root).width);
    },
  );

  it('aligns a single feasible constraint through mixed nested layouts', () => {
    let seed = 4483,
      count = 0;
    const random = (n: number) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % n;
    };
    const align = () => ['start', 'center', 'end', 'expand'][random(4)];
    const branch = (id: string, source: boolean, depth: number): Record<string, unknown> => {
      if (!depth)
        return {
          id,
          icon: ['general.application', 'network.router', 'general.database'][random(3)],
          label: source ? 'SOURCE' : 'Target',
          ...(source ? { align_with: 'target' } : {}),
        };
      const child = branch(id, source, depth - 1);
      const other = {
        id: `filler${++count}`,
        icon: 'general.application',
        label: 'A descriptive service name '.repeat(1 + random(3)),
      };
      const children = random(2) ? [child, other] : [other, child];
      return random(2)
        ? { [random(2) ? 'row' : 'column']: children, align: align() }
        : {
            group: random(2) ? 'gcp.project' : 'general.generic',
            label: `Boundary ${count}`,
            direction: random(2) ? 'horizontal' : 'vertical',
            align: align(),
            children,
          };
    };
    for (let i = 0; i < 400; i++) {
      const diagram = load(
        JSON.stringify({
          nodes: [
            {
              [i % 2 ? 'row' : 'column']: [branch('source', true, 2), branch('target', false, 2)],
              align: align(),
            },
          ],
        }),
      );
      const centers = new Map(
        [...layoutDiagram(diagram.root).cells].map(([node, rect]) => [
          node.id,
          i % 2 ? rect.y + rect.height / 2 : rect.x + rect.width / 2,
        ]),
      );
      expect(centers.get('source'), `nested case ${i}`).toBe(centers.get('target'));
    }
  });

  it.each(['n', 'e', 's', 'w'])('gives a self-link at %s a visible loop', (position) => {
    const diagram = load(`nodes: [{id: queue, icon: general.application, label: Queue}]
links: [{from: queue.${position}, to: queue.${position}, label: Retry}]
`);
    const layout = layoutDiagram(diagram.root);
    const path = predictPath(diagram.links[0]!, routeContext(diagram.root, layout, diagram.links))!;
    expect(new Set(path.map((point) => `${point.x},${point.y}`)).size).toBeGreaterThanOrEqual(4);
    expect(findCrossings(diagram, layout).crossings).toEqual([]);
    expect(toDrawio(diagram, layout)).toContain('edgeStyle=segmentEdgeStyle');
  });

  it('keeps a sideways link clear of the middle icon in a vertical stack', () => {
    const diagram = load(`direction: vertical
nodes:
  - {id: a, icon: general.application}
  - {id: b, icon: general.application}
  - {id: c, icon: general.application}
links: [[a.e, c.w]]
`);
    const layout = layoutDiagram(diagram.root);
    expect(findCrossings(diagram, layout).crossings).toEqual([]);
    const middle = [...layout.cells].find(([node]) => node.id === 'b')![1];
    const path = predictPath(diagram.links[0]!, routeContext(diagram.root, layout, diagram.links))!;
    for (const [a, b] of segmentsOf(path)) {
      expect(
        Math.max(a.x, b.x) > middle.x &&
          Math.min(a.x, b.x) < middle.x + middle.width &&
          Math.max(a.y, b.y) > middle.y &&
          Math.min(a.y, b.y) < middle.y + middle.height,
      ).toBe(false);
    }
  });

  it.each([
    ['ene', 'e'],
    ['e', 'ese'],
    ['n', 'nne'],
    ['s', 'sse'],
    ['w', 'wnw'],
  ])('separates adjacent border icons at %s and %s', (first, second) => {
    const diagram = load(
      JSON.stringify({
        nodes: [
          {
            group: 'aws.vpc',
            border: {
              [first]: { id: 'a', icon: 'general.application', label: 'Endpoint A' },
              [second]: { id: 'b', icon: 'general.application', label: 'Endpoint B' },
            },
            children: [{ id: 'app', icon: 'general.application' }],
          },
        ],
      }),
    );
    const rects = new Map(
      [...layoutDiagram(diagram.root).cells].map(([node, rect]) => [node.id, rect]),
    );
    const a = rects.get('a')!,
      b = rects.get('b')!;
    expect(
      a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y,
    ).toBe(true);
  });

  it('marks native routing as unchecked even with both sides specified', () => {
    const diagram = load(
      'nodes: [{id: a, icon: aws.ecs}, {id: b, icon: aws.ecs}]\nlinks: [{from: a.e, to: b.w, route: drawio}]\n',
    );
    const report = findCrossings(diagram, layoutDiagram(diagram.root));
    expect(report.crossings).toEqual([]);
    expect(report.unchecked).toEqual(diagram.links);
  });

  it.each(['label', 'title', 'layer'])(
    'rejects invalid XML characters in a %s but keeps ordinary Unicode',
    (field) => {
      const make = (text: string) =>
        JSON.stringify({
          ...(field === 'title' ? { title: text } : {}),
          ...(field === 'layer' ? { layers: [text] } : {}),
          nodes: [
            {
              id: 'a',
              icon: 'aws.ecs',
              ...(field === 'label' ? { label: text } : {}),
              ...(field === 'layer' ? { layer: text } : {}),
            },
          ],
        });
      for (const char of ['\0', '\b', '\v', '\f', '\u001f', '\ud800'])
        expect(problemsOf(make(`before${char}after`)).join('\n')).toContain('valid XML characters');
      expect(() => load(make('日本語 🚀 & <text>\nSecond line'))).not.toThrow();
    },
  );

  it('reports a cyclic YAML alias at the alias instead of exhausting the stack', () => {
    expect(problemsOf('nodes: &nodes\n  - group: general.generic\n    children: *nodes\n')).toEqual(
      ['3:15: circular YAML alias "nodes"'],
    );
    expect(() =>
      load('nodes:\n  - {id: a, icon: &service aws.ecs}\n  - {id: b, icon: *service}\n'),
    ).not.toThrow();
  });

  it('rejects a header-only PNG and malformed SVGs before embedding them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yaml2drawio-bad-images-'));
    try {
      writeFileSync(
        join(dir, 'bad.png'),
        readFileSync(new URL('fixtures/images/small.png', import.meta.url)).subarray(0, 33),
      );
      expect(() => readImage('bad.png', dir)).toThrow('not a readable png');
      for (const svg of [
        '<svg width="100" height="50"><g>',
        '<!-- <svg width="100" height="50"> --><not-svg/>',
        '<svg><g></svg>',
      ]) {
        writeFileSync(join(dir, 'bad.svg'), svg);
        expect(() => readImage('bad.svg', dir)).toThrow('not a readable svg');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
