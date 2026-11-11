import { crc32, inflateSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
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
  const width = data.readUInt32BE(16),
    height = data.readUInt32BE(20);
  const depth = data[24] ?? 0,
    color = data[25] ?? -1,
    interlace = data[28];
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const depths = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (
    !width ||
    !height ||
    !channels[color] ||
    !depths.includes(depth) ||
    data[26] !== 0 ||
    data[27] !== 0 ||
    (interlace !== 0 && interlace !== 1)
  )
    return undefined;
  const chunks: Buffer[] = [];
  let ended = false,
    palette = false,
    idatEnded = false;
  for (let offset = 8; offset < data.length;) {
    if (offset + 12 > data.length) return undefined;
    const length = data.readUInt32BE(offset);
    const end = offset + length + 12;
    if (
      end > data.length ||
      crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)
    )
      return undefined;
    const name = data.toString('ascii', offset + 4, offset + 8);
    if (offset !== 8 && name === 'IHDR') return undefined;
    if (name === 'PLTE') {
      if (chunks.length || length === 0 || length % 3 !== 0 || length > 768) return undefined;
      palette = true;
    }
    if (name === 'IDAT') {
      if (idatEnded) return undefined;
      chunks.push(data.subarray(offset + 8, end - 4));
    } else if (chunks.length) idatEnded = true;
    if (name === 'IEND') {
      ended = length === 0 && end === data.length;
      break;
    }
    if (!['IHDR', 'PLTE', 'IDAT'].includes(name) && /^[A-Z]/.test(name)) return undefined;
    offset = end;
  }
  if (!ended || chunks.length === 0 || (color === 3 && !palette)) return undefined;
  const passes =
    interlace === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  const rows = passes.flatMap(([x = 0, y = 0, dx = 1, dy = 1]) => {
    const w = Math.max(0, Math.ceil((width - x) / dx)),
      h = Math.max(0, Math.ceil((height - y) / dy));
    return w && h
      ? [{ count: h, bytes: 1 + Math.ceil((w * depth * (channels[color] ?? 1)) / 8) }]
      : [];
  });
  const expected = rows.reduce((sum, row) => sum + row.count * row.bytes, 0);
  try {
    const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected + 1 });
    if (raw.length !== expected) return undefined;
    let offset = 0;
    for (const row of rows)
      for (let i = 0; i < row.count; i++) {
        if ((raw[offset] ?? 5) > 4) return undefined;
        offset += row.bytes;
      }
  } catch {
    return undefined;
  }
  return { width, height };
}

// An SVG without a usable size is drawn square; draw.io still keeps its proportions inside the box
function svgSize(text: string): { width: number; height: number } | undefined {
  let attributes: Record<string, string> | undefined;
  let rootSeen = false,
    svgRoot = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('opentag', (tag) => {
    if (rootSeen) return;
    rootSeen = true;
    svgRoot = tag.local === 'svg' && (tag.uri === '' || tag.uri === 'http://www.w3.org/2000/svg');
    attributes = Object.fromEntries(
      Object.entries(tag.attributes).map(([key, value]) => [key, value.value]),
    );
  });
  try {
    parser.write(text).close();
  } catch {
    return undefined;
  }
  if (!svgRoot || !attributes) return undefined;
  const rootAttributes = attributes;
  const attribute = (name: string) => rootAttributes[name];
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
