import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readImage } from '../src/image.ts';

const FIXTURES = fileURLToPath(new URL('fixtures/images', import.meta.url));

describe('readImage', () => {
  it('embeds the file in the style as a data URI that draw.io reads', () => {
    const shape = readImage('wide.svg', FIXTURES);
    const data = readFileSync(`${FIXTURES}/wide.svg`).toString('base64');
    expect(shape.style).toContain(`image=data:image/svg+xml,${data};`);
    expect(shape.title).toBe('wide');
  });

  it.each([
    ['the viewBox of an SVG', 'wide.svg', { width: 120, height: 60 }],
    ['the width and height of an SVG without a viewBox', 'sized.svg', { width: 30, height: 10 }],
    ['a square for an SVG without a size', 'unsized.svg', { width: 1, height: 1 }],
    ['the header of a PNG', 'small.png', { width: 3, height: 2 }],
  ])('keeps the proportions from %s', (_, file, size) => {
    expect(readImage(file, FIXTURES)).toMatchObject(size);
  });

  it.each([
    ['missing.svg', 'image "missing.svg" not found (paths are relative to the YAML file)'],
    ['logo.gif', 'image "logo.gif" must be an .svg or .png file'],
  ])('explains why %s cannot be drawn', (file, message) => {
    expect(() => readImage(file, FIXTURES)).toThrow(message);
  });
});
