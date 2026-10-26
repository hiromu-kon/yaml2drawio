// Builds the AWS icon catalog (catalog/aws.json) from draw.io's sidebar definitions.
//   pnpm catalog
import { writeFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const DRAWIO_TAG = 'v32.6.1';
const SOURCE_PATH = 'src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js';
const OUTPUT = new URL('../catalog/aws.json', import.meta.url);

type Kind = 'service' | 'resource' | 'group';

interface RawEntry {
  palette: string;
  title: string;
  style: string;
  width: number;
  height: number;
}

interface CatalogEntry {
  title: string;
  category: string;
  kind: Kind;
  style: string;
  width: number;
  height: number;
}

type Template = { style: string; width: number; height: number; value: string; title: string };

function Sidebar() {}

// Style strings are built by concatenating variables, so extracting them with regular expressions
// would resolve the concatenation incorrectly. Evaluate draw.io's code as is and capture the values
// it registers to the palette.
function evaluateSidebar(source: string): RawEntry[] {
  const entries: RawEntry[] = [];
  Sidebar.prototype.setCurrentSearchEntryLibrary = () => {};
  Sidebar.prototype.getTagsForStencil = () => [];
  Sidebar.prototype.createEdgeTemplateEntry = () => null;
  Sidebar.prototype.createVertexTemplateEntry = (
    style: string,
    width: number,
    height: number,
    value: string,
    title: string,
  ): Template => ({ style, width, height, value, title });
  Sidebar.prototype.addPaletteFunctions = (
    _id: string,
    palette: string,
    _expand: boolean,
    templates: (Template | null)[],
  ) => {
    for (const t of templates) {
      if (t === null) continue;
      entries.push({
        palette,
        title: t.title || t.value,
        style: t.style,
        width: t.width,
        height: t.height,
      });
    }
  };

  const context = createContext({ Sidebar, mxConstants: { STYLE_SHAPE: 'shape' } });
  runInContext(source, context);
  runInContext('new Sidebar().addAWS4Palette()', context);
  return entries;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function kindOf(entry: RawEntry): Kind {
  if (entry.palette === 'AWS / Groups') return 'group';
  return entry.style.includes('resourceIcon') ? 'service' : 'resource';
}

function buildCatalog(raw: RawEntry[]): Record<'icons' | 'groups', Record<string, CatalogEntry>> {
  const icons: Record<string, CatalogEntry> = {};
  const groups: Record<string, CatalogEntry> = {};
  // Register services first so that a service icon gets the bare name when a resource icon shares it
  const order: Record<Kind, number> = { service: 0, resource: 1, group: 2 };
  const sorted = raw.toSorted((a, b) => order[kindOf(a)] - order[kindOf(b)]);

  for (const entry of sorted) {
    const kind = kindOf(entry);
    const target = kind === 'group' ? groups : icons;
    const category = entry.palette.replace(/^AWS \/ /, '');
    const base = slug(entry.title);
    if (Object.values(target).some((e) => e.style === entry.style)) continue;

    let key = base;
    if (key in target) key = kind === 'resource' ? `${base}_resource` : `${base}_${slug(category)}`;
    for (let n = 2; key in target; n++) key = `${base}_${n}`;

    target[key] = {
      title: entry.title,
      category,
      kind,
      style: entry.style,
      width: entry.width,
      height: entry.height,
    };
  }
  return { icons: sortKeys(icons), groups: sortKeys(groups) };
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}

const url = `https://raw.githubusercontent.com/jgraph/drawio/${DRAWIO_TAG}/${SOURCE_PATH}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
const catalog = buildCatalog(evaluateSidebar(await response.text()));

await writeFile(
  OUTPUT,
  `${JSON.stringify({ source: { repository: 'jgraph/drawio', tag: DRAWIO_TAG, path: SOURCE_PATH }, ...catalog }, null, 2)}\n`,
);
console.log(
  `wrote ${Object.keys(catalog.icons).length} icons and ${Object.keys(catalog.groups).length} groups`,
);
