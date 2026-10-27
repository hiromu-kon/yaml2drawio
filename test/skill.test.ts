import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NAMESPACES } from '../src/catalog.ts';
import { catalog } from './helpers.ts';

const skill = new URL('../skills/yaml2drawio/', import.meta.url);
const files = [
  new URL('SKILL.md', skill),
  ...readdirSync(new URL('references/', skill)).map((name) => new URL(`references/${name}`, skill)),
  new URL('../docs/guide.md', import.meta.url),
];
const text = readFileSync(new URL('SKILL.md', skill), 'utf8');

describe('skills/yaml2drawio', () => {
  // Rules from the Agent Skills specification, https://agentskills.io/specification
  it('has the frontmatter the Agent Skills specification requires', () => {
    const [, frontmatter = ''] = /^---\n(.*?)\n---\n/s.exec(text) ?? [];
    expect(parse(frontmatter)).toMatchObject({
      name: 'yaml2drawio',
      description: expect.stringMatching(/^.{1,1024}$/s),
    });
  });

  it('links only to files that exist', () => {
    const targets = [...text.matchAll(/\]\(([^)]+\.md)\)/g)].map(([, target = '']) => target);
    expect(targets.filter((target) => !existsSync(new URL(target, skill)))).toEqual([]);
  });

  it.each(files.map((file) => [file.pathname.split('/').slice(-2).join('/'), file]))(
    'names only icons and groups in the catalog in %s',
    (_, file) => {
      const names = new Set([...catalog.names('icon'), ...catalog.names('group')]);
      // A name such as aws.ecs, but not a file such as references/aws.md
      const pattern = new RegExp(
        `(?<![/\\w])(?:${NAMESPACES.join('|')})\\.[a-z0-9_]+(?!\\.md)`,
        'g',
      );
      const mentioned = [...readFileSync(file, 'utf8').matchAll(pattern)].map(([name]) => name);
      expect(mentioned.filter((name) => !names.has(name))).toEqual([]);
    },
  );
});
