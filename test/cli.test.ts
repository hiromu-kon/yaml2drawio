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

describe('CLI output safety', () => {
  it.each(['direct', 'symlink', 'hardlink'])('preserves YAML through a %s output alias', (kind) => {
    const output = kind === 'direct' ? input : join(dir, 'alias.drawio');
    if (kind === 'symlink') symlinkSync(input, output);
    if (kind === 'hardlink') linkSync(input, output);
    const result = run('build', input, '-o', output);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('would overwrite');
    expect(readFileSync(input, 'utf8')).toBe(VALID);
  });

  it('protects image inputs before PNG export', () => {
    const image = join(dir, 'diagram.png');
    const data = readFileSync(new URL('fixtures/images/small.png', import.meta.url));
    writeFileSync(image, data);
    writeFileSync(input, 'nodes:\n  - {id: app, image: diagram.png}\n');
    expect(run('build', input, '--png').status).toBe(1);
    expect(readFileSync(image)).toEqual(data);
    expect(existsSync(join(dir, 'diagram.drawio'))).toBe(false);
  });

  it('protects draw.io output from PNG export through a dangling symlink', () => {
    const output = join(dir, 'diagram.drawio');
    symlinkSync(output, join(dir, 'diagram.png'));
    expect(run('build', input, '--png').status).toBe(1);
    expect(readFileSync(output, 'utf8')).toContain('<mxfile');
  });
});
