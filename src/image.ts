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
  if (!size || ![size.width, size.height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error(`image "${path}" is not a readable ${extname(path).slice(1)} file`);
  return {
    key: path,
    title: basename(path, extname(path)),
    category: 'Image',
    sourcePath: resolve(baseDir, path),
    kind: 'resource',
    // ";base64" would end the style entry, so draw.io writes data URIs without it
    style: `shape=image;html=1;imageAspect=1;aspect=fixed;image=data:${type},${data.toString('base64')};`,
    ...size,
  };
}

function pngSize(data: Buffer): { width: number; height: number } | undefined {
  // The IHDR chunk always comes first, right after the 8-byte signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    data.length < 33 ||
    !data.subarray(0, 8).equals(signature) ||
    data.readUInt32BE(8) !== 13 ||
    data.toString('ascii', 12, 16) !== 'IHDR'
  )
    return undefined;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

// An SVG without a usable size is drawn square; draw.io still keeps its proportions inside the box
function svgSize(text: string): { width: number; height: number } | undefined {
  const root = /<svg(?=[\s/>])[^>]*>/i.exec(text)?.[0];
  if (!root) return undefined;
  const attribute = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(root)?.[1];
  const [width, height] = [attribute('width'), attribute('height')].map((value) =>
    value && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(value)
      ? Number.parseFloat(value)
      : undefined,
  );
  if (
    [width, height].some((value) => value !== undefined && (!Number.isFinite(value) || value <= 0))
  )
    return undefined;
  const viewBox = attribute('viewBox');
  if (viewBox !== undefined) {
    const box = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const [, , boxWidth, boxHeight] = box;
    if (
      box.length !== 4 ||
      !box.every(Number.isFinite) ||
      !boxWidth ||
      !boxHeight ||
      boxWidth < 0 ||
      boxHeight < 0
    )
      return undefined;
    return { width: boxWidth, height: boxHeight };
  }
  return width && height ? { width, height } : { width: 1, height: 1 };
}
