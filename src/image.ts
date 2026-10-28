import { readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { Shape } from './catalog.ts';

const TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png' };

/**
 * An icon drawn from an SVG or PNG file. The file is embedded in the draw.io file, so the diagram
 * stays one file that opens anywhere.
 */
export function readImage(path: string, baseDir: string): Shape {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`image "${path}" must be an .svg or .png file`);
  let data: Buffer;
  try {
    data = readFileSync(resolve(baseDir, path));
  } catch {
    throw new Error(`image "${path}" not found (paths are relative to the YAML file)`);
  }
  const size = type === 'image/png' ? pngSize(data) : svgSize(data.toString('utf8'));
  if (!size) throw new Error(`image "${path}" is not a readable ${extname(path).slice(1)} file`);
  return {
    key: path,
    title: basename(path, extname(path)),
    category: 'Image',
    kind: 'resource',
    // ";base64" would end the style entry, so draw.io writes data URIs without it
    style: `shape=image;html=1;imageAspect=1;aspect=fixed;image=data:${type},${data.toString('base64')};`,
    ...size,
  };
}

function pngSize(data: Buffer): { width: number; height: number } | undefined {
  // The IHDR chunk always comes first, right after the 8-byte signature
  if (data.length < 24 || data.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

// An SVG without a usable size is drawn square; draw.io still keeps its proportions inside the box
function svgSize(text: string): { width: number; height: number } | undefined {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!root) return undefined;
  const attribute = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(root)?.[1];
  const [, , boxWidth, boxHeight] =
    attribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  if (boxWidth && boxHeight && boxWidth > 0 && boxHeight > 0) {
    return { width: boxWidth, height: boxHeight };
  }
  const [width, height] = [attribute('width'), attribute('height')].map((value) =>
    value && /^[\d.]+(px)?$/.test(value) ? Number.parseFloat(value) : undefined,
  );
  return width && height ? { width, height } : { width: 1, height: 1 };
}
