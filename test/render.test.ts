import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SaxesParser } from 'saxes';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { toDrawio } from '../src/drawio.ts';
import { layoutDiagram, type Rect } from '../src/layout.ts';
import { predictPath, routeContext, segmentsOf, type Point, type Segment } from '../src/route.ts';
import { load } from './helpers.ts';

const ports = ['n', 'e', 's', 'w'] as const;
const cases: { name: string; input: string }[] = [];
for (const direction of ['horizontal', 'vertical'])
  for (const from of ports)
    for (const to of ports) {
      cases.push({
        name: `${direction}-${from}-${to}`,
        input: JSON.stringify({
          direction,
          nodes: ['a', 'b', 'c'].map((id) => ({ id, icon: 'general.application', label: id })),
          links: [[`a.${from}`, `c.${to}`]],
        }),
      });
      cases.push({
        name: `nested-${direction}-${from}-${to}`,
        input: JSON.stringify({
          direction,
          nodes: [
            { id: 'a', icon: 'general.application' },
            {
              group: 'gcp.project',
              label: 'Application project',
              children: [
                {
                  group: 'gcp.subnet',
                  label: 'Service subnet',
                  children: [{ id: 'c', icon: 'network.router' }],
                },
              ],
            },
          ],
          links: [[`a.${from}`, `c.${to}`]],
        }),
      });
    }
for (const from of ports)
  for (const to of ports)
    cases.push({
      name: `self-${from}-${to}`,
      input: JSON.stringify({
        nodes: [{ id: 'a', icon: 'general.application', label: 'Queue' }],
        links: [[`a.${from}`, `a.${to}`]],
      }),
    });
for (const from of ['ene', 'ese', 'nne', 'nnw'])
  for (const to of ['wsw', 'wnw'])
    cases.push({
      name: `quarter-${from}-${to}`,
      input: JSON.stringify({
        nodes: [
          { id: 'a', icon: 'general.application' },
          { id: 'c', icon: 'network.router' },
        ],
        links: [[`a.${from}`, `c.${to}`]],
      }),
    });

// Optional native integration test: the regular suite needs no desktop installation.
// Set DRAWIO_CLI to the draw.io executable to compare exported SVG geometry, not screenshots.
describe.skipIf(!process.env['DRAWIO_CLI'])('draw.io exported route geometry', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yaml2drawio-render-'));
    await mkdir(join(dir, 'input'));
    await mkdir(join(dir, 'svg'));
    await Promise.all(
      cases.map(async ({ name, input }) => {
        const diagram = load(input);
        await writeFile(
          join(dir, 'input', `${name}.drawio`),
          toDrawio(diagram, layoutDiagram(diagram.root)),
        );
      }),
    );
    await promisify(execFile)(
      process.env['DRAWIO_CLI']!,
      [
        '--export',
        '--format',
        'svg',
        '--embed-svg-metadata',
        '--embed-svg-fonts',
        'false',
        '--theme',
        'light',
        '--timeout',
        '10',
        '--output',
        join(dir, 'svg'),
        join(dir, 'input'),
      ],
      { timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
    );
  }, 130000);
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it.each(cases)('$name renders the checked polyline', async ({ name, input }) => {
    const diagram = load(input),
      layout = layoutDiagram(diagram.root);
    const expected = predictPath(
      diagram.links[0]!,
      routeContext(diagram.root, layout, diagram.links),
    )!;
    const svg = inspectSvg(await readFile(join(dir, 'svg', `${name}.svg`), 'utf8'));
    const original = [...layout.cells].find(([node]) => node.id === 'a')![1];
    const source = svg.bounds.get('a')!;
    expect(source).toBeDefined();
    const shift = { x: source.x - original.x, y: source.y - original.y };
    const raw = svg.paths.get('.link-1');
    expect(raw).toBeDefined();
    const actual = [...raw!.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(
      (match) => ({ x: Number(match[1]) - shift.x, y: Number(match[2]) - shift.y }),
    );
    expect(actual.length).toBeGreaterThan(1);
    const expectedSegments = segmentsOf(expected),
      actualSegments = segmentsOf(actual);
    for (const [a, b] of actualSegments) {
      expect(
        expectedSegments.some((segment) => onSegment(a, segment) && onSegment(b, segment)),
        `unexpected SVG segment in ${name}`,
      ).toBe(true);
    }
    // The renderer may shorten the final segment for an arrowhead, but every interior turn
    // must still exist. This also catches loops silently collapsed into a zero-length edge.
    for (const point of expected.slice(1, -1))
      expect(
        actualSegments.some((segment) => onSegment(point, segment)),
        `missing turn in ${name}`,
      ).toBe(true);
  });
});

function onSegment(point: Point, [a, b]: Segment): boolean {
  const tolerance = 0.6; // SVG export uses half-pixel stroke translation.
  return (
    point.x >= Math.min(a.x, b.x) - tolerance &&
    point.x <= Math.max(a.x, b.x) + tolerance &&
    point.y >= Math.min(a.y, b.y) - tolerance &&
    point.y <= Math.max(a.y, b.y) + tolerance &&
    (Math.abs(a.x - b.x) < tolerance
      ? Math.abs(point.x - a.x) < tolerance
      : Math.abs(point.y - a.y) < tolerance)
  );
}

function inspectSvg(text: string): { bounds: Map<string, Rect>; paths: Map<string, string> } {
  const bounds = new Map<string, Rect>(),
    paths = new Map<string, string>();
  const stack: (string | undefined)[] = [];
  let cell: string | undefined;
  const parser = new SaxesParser();
  parser.on('opentag', (tag) => {
    stack.push(cell);
    if (typeof tag.attributes['data-cell-id'] === 'string') cell = tag.attributes['data-cell-id'];
    if (!cell) return;
    if (tag.name === 'rect' && !bounds.has(cell))
      bounds.set(cell, {
        x: Number(tag.attributes['x']),
        y: Number(tag.attributes['y']),
        width: Number(tag.attributes['width']),
        height: Number(tag.attributes['height']),
      });
    if (tag.name === 'path' && cell.startsWith('.link-') && !paths.has(cell))
      paths.set(cell, String(tag.attributes['d']));
  });
  parser.on('closetag', () => {
    cell = stack.pop();
  });
  parser.write(text).close();
  return { bounds, paths };
}
