import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findCrossings } from '../src/crossings.ts';
import { layoutDiagram } from '../src/layout.ts';
import { load } from './helpers.ts';

const examples = new URL('../examples/', import.meta.url);

describe('examples', () => {
  // The examples are what people copy from, and the README shows them
  it.each(readdirSync(examples).filter((file) => file.endsWith('.yaml')))(
    'builds examples/%s without crossings or unchecked lines',
    (file) => {
      const diagram = load(readFileSync(new URL(file, examples), 'utf8'));
      expect(findCrossings(diagram, layoutDiagram(diagram.root))).toEqual({
        crossings: [],
        unchecked: [],
      });
    },
  );
});
