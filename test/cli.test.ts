import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  linkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const VALID = 'nodes:\n  - {id: app, icon: aws.ecs}\n';
let dir: string;
let input: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yaml2drawio-cli-'));
  input = join(dir, 'diagram.yaml');
  writeFileSync(input, VALID);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function run(...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

describe('CLI checks and output safety', () => {
  it('protects an image input from PNG export before writing any output', () => {
    const image = join(dir, 'diagram.png');
    const data = readFileSync(new URL('fixtures/images/small.png', import.meta.url));
    writeFileSync(image, data);
    writeFileSync(input, 'nodes:\n  - {id: app, image: diagram.png}\n');
    const result = run('build', input, '--png', '--json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      outputs: [],
      diagnostics: [expect.objectContaining({ code: 'unsafe-output' })],
    });
    expect(readFileSync(image)).toEqual(data);
    expect(existsSync(join(dir, 'diagram.drawio'))).toBe(false);
  });

  it('does not export a PNG over the draw.io file through a dangling symlink', () => {
    const output = join(dir, 'diagram.drawio');
    symlinkSync(output, join(dir, 'diagram.png'));
    const result = run('build', input, '--png', '--json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      outputs: [output],
      diagnostics: [expect.objectContaining({ code: 'unsafe-output' })],
    });
    expect(readFileSync(output, 'utf8')).toContain('<mxfile');
  });
  it('validates without touching an existing draw.io file', () => {
    const output = join(dir, 'diagram.drawio');
    writeFileSync(output, 'hand-edited diagram');
    const result = run('validate', input, '--strict', '--json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, diagnostics: [], outputs: [] });
    expect(readFileSync(output, 'utf8')).toBe('hand-edited diagram');
  });

  it.each(['direct', 'symlink', 'hardlink'])(
    'preserves the YAML when the output is a %s alias',
    (kind) => {
      const output = kind === 'direct' ? input : join(dir, 'alias.drawio');
      if (kind === 'symlink') symlinkSync(input, output);
      if (kind === 'hardlink') linkSync(input, output);
      const result = run('build', input, '-o', output, '--json');
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
        expect.objectContaining({ code: 'unsafe-output', severity: 'error' }),
      );
      expect(readFileSync(input, 'utf8')).toBe(VALID);
    },
  );

  it('protects an image input from the draw.io output', () => {
    const image = join(dir, 'logo.svg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    writeFileSync(image, svg);
    writeFileSync(input, 'nodes:\n  - {id: app, image: logo.svg}\n');
    expect(run('build', input, '-o', image).status).toBe(1);
    expect(readFileSync(image, 'utf8')).toBe(svg);
  });

  it('only fails unchecked links when requested', () => {
    writeFileSync(
      input,
      'nodes:\n  - {id: a, icon: aws.ecs}\n  - {id: b, icon: aws.s3}\nlinks: [[a, b]]\n',
    );
    const normal = run('validate', input, '--strict', '--json');
    expect(normal.status).toBe(0);
    expect(JSON.parse(normal.stdout).diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unchecked-link',
        severity: 'note',
        linkId: 'link-1',
        line: 4,
      }),
    );
    const strict = run('validate', input, '--fail-unchecked', '--json');
    expect(strict.status).toBe(1);
    expect(JSON.parse(strict.stdout)).toMatchObject({ ok: false, outputs: [] });
  });

  it('reports warnings with codes, link ids, related ids and source locations', () => {
    writeFileSync(
      input,
      'nodes:\n  - {id: a, icon: aws.ecs}\n  - {id: b, icon: aws.ecs}\n  - {id: c, icon: aws.ecs}\nlinks:\n  - {from: a.e, to: c.w, route: drawio}\n',
    );
    const result = run('validate', input, '--strict', '--json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'crossing-icon',
        severity: 'warning',
        linkId: 'link-1',
        relatedId: 'b',
        line: 6,
      }),
    );
  });

  it('still writes artifacts when strict checks fail', () => {
    writeFileSync(
      input,
      'nodes:\n  - {id: a, icon: aws.ecs}\n  - {id: b, icon: aws.ecs}\nlinks: [[a.ne, b.w]]\n',
    );
    const result = run('build', input, '--strict', '--json');
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).outputs).toEqual([join(dir, 'diagram.drawio')]);
    expect(existsSync(join(dir, 'diagram.drawio'))).toBe(true);
  });

  it.each([
    ['validate', 'missing.yaml', '--json'],
    ['validate', '--json'],
    ['validate', 'a.yaml', 'b.yaml', '--json'],
    ['validate', 'a.yaml', '--png', '--json'],
    ['validate', 'a.yaml', '--bad-option', '--json'],
    ['icons', 's3', '--json'],
  ])('returns a single JSON error for %j', (...args) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      outputs: [],
      diagnostics: [expect.objectContaining({ severity: 'error' })],
    });
    expect(result.stderr).toBe('');
  });

  it('reports invalid YAML without writing an output', () => {
    writeFileSync(input, 'nodes: [');
    const result = run('build', input, '--json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).diagnostics[0]).toMatchObject({ severity: 'error', line: 1 });
    expect(existsSync(join(dir, 'diagram.drawio'))).toBe(false);
  });
});
