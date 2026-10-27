import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findCrossings } from '../src/crossings.ts';
import { layoutDiagram } from '../src/layout.ts';
import { KNOWN_KEYS, POSITIONS } from '../src/schema.ts';
import { load } from './helpers.ts';

const guide = readFileSync(new URL('../docs/guide.md', import.meta.url), 'utf8');
const diagrams = [...guide.matchAll(/```yaml\n(.*?)```/gs)]
  .map(([, block = '']) => block)
  .filter((block) => block.includes('nodes:'));

describe('docs/guide.md', () => {
  it('has a complete example that builds without warnings', () => {
    expect(diagrams.length).toBeGreaterThan(0);
    for (const source of diagrams) {
      const diagram = load(source);
      expect(findCrossings(diagram, layoutDiagram(diagram.root))).toEqual({
        crossings: [],
        unchecked: [],
      });
    }
  });

  it.each([...KNOWN_KEYS])('explains the key %s', (key) => {
    expect(guide).toContain(`\`${key}\``);
  });

  it('shows every position', () => {
    for (const position of POSITIONS) expect(guide).toMatch(new RegExp(`\\b${position}\\b`));
  });
});
