import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readImage } from '../src/image.ts';
import { iconSize } from '../src/layout.ts';

const FIXTURES = fileURLToPath(new URL('fixtures/images', import.meta.url));

describe('readImage', () => {
  it.each([
    '<svg width="0" height="10"/>',
    '<svg width="10" height="-2"/>',
    '<svg viewBox="0 0 1e309 10"/>',
    '<svg viewBox="0 0 10"/>',
    '<svg-image width="10" height="10"/>',
  ])('rejects unusable SVG dimensions in %s', (svg) => {
    const dir = mkdtempSync(join(tmpdir(), 'yaml2drawio-image-'));
    try {
      writeFileSync(join(dir, 'bad.svg'), svg);
      expect(() => readImage('bad.svg', dir)).toThrow('not a readable svg');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each([
    [1000, 5],
    [5, 1000],
  ])('keeps a thin %sx%s SVG visible after scaling', (width, height) => {
    const dir = mkdtempSync(join(tmpdir(), 'yaml2drawio-image-'));
    try {
      writeFileSync(join(dir, 'thin.svg'), `<svg width="${width}" height="${height}"/>`);
      const size = iconSize(readImage('thin.svg', dir));
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['signature', 'truncated', 'zero width', 'zero height', 'chunk length'])(
    'rejects a PNG with a bad %s',
    (kind) => {
      const dir = mkdtempSync(join(tmpdir(), 'yaml2drawio-image-'));
      try {
        let data = Buffer.from(readFileSync(`${FIXTURES}/small.png`));
        if (kind === 'signature') data[0] = 0;
        if (kind === 'truncated') data = data.subarray(0, 24);
        if (kind === 'zero width') data.writeUInt32BE(0, 16);
        if (kind === 'zero height') data.writeUInt32BE(0, 20);
        if (kind === 'chunk length') data.writeUInt32BE(0, 8);
        writeFileSync(join(dir, 'bad.png'), data);
        expect(() => readImage('bad.png', dir)).toThrow('not a readable png');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
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
