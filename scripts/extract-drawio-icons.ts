// Builds the icon catalogs (catalog/<namespace>.json) from draw.io's sidebar definitions.
//   pnpm catalog
import { writeFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const DRAWIO_TAG = 'v32.6.1';
const SIDEBAR_DIR = 'src/main/webapp/js/diagramly/sidebar';

type Kind = 'service' | 'resource' | 'group';

interface Source {
  namespace: string;
  file: string;
  /** The Sidebar method that registers the palettes. */
  palette: string;
  kind: (entry: RawEntry) => Kind;
  category: (entry: RawEntry) => string;
}

const SOURCES: Source[] = [
  {
    namespace: 'aws',
    file: 'Sidebar-AWS4.js',
    palette: 'addAWS4Palette',
    kind: (entry) => {
      if (entry.palette === 'AWS / Groups') return 'group';
      return entry.style.includes('resourceIcon') ? 'service' : 'resource';
    },
    category: (entry) => entry.palette.replace(/^AWS \/ /, ''),
  },
  {
    // Devices and on-premises equipment that no cloud library has, such as routers and switches
    namespace: 'network',
    file: 'Sidebar-Network.js',
    palette: 'addNetworkPalette',
    kind: () => 'resource',
    category: () => 'Network',
  },
];

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
function evaluateSidebar(source: string, method: string): RawEntry[] {
  const entries: RawEntry[] = [];
  Sidebar.prototype.setCurrentSearchEntryLibrary = () => {};
  Sidebar.prototype.getTagsForStencil = () => [];
  Sidebar.prototype.createEdgeTemplateEntry = () => null;
  // Entries drawn as embedded images (network topologies such as a ring bus) are not icons
  Sidebar.prototype.addDataEntry = () => null;
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
  runInContext(`new Sidebar().${method}()`, context);
  return entries;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function buildCatalog(
  raw: RawEntry[],
  { kind: kindOf, category: categoryOf }: Source,
): Record<'icons' | 'groups', Record<string, CatalogEntry>> {
  const icons: Record<string, CatalogEntry> = {};
  const groups: Record<string, CatalogEntry> = {};
  // Register services first so that a service icon gets the bare name when a resource icon shares it
  const order: Record<Kind, number> = { service: 0, resource: 1, group: 2 };
  const sorted = raw.toSorted((a, b) => order[kindOf(a)] - order[kindOf(b)]);

  for (const entry of sorted) {
    const kind = kindOf(entry);
    const target = kind === 'group' ? groups : icons;
    const category = categoryOf(entry);
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

// evaluateSidebar runs synchronously after each fetch, so the sources cannot mix up their entries
await Promise.all(
  SOURCES.map(async (source) => {
    const path = `${SIDEBAR_DIR}/${source.file}`;
    const url = `https://raw.githubusercontent.com/jgraph/drawio/${DRAWIO_TAG}/${path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
    const catalog = buildCatalog(evaluateSidebar(await response.text(), source.palette), source);
    await writeFile(
      new URL(`../catalog/${source.namespace}.json`, import.meta.url),
      `${JSON.stringify({ source: { repository: 'jgraph/drawio', tag: DRAWIO_TAG, path }, ...catalog }, null, 2)}\n`,
    );
    console.log(
      `wrote catalog/${source.namespace}.json: ${Object.keys(catalog.icons).length} icons, ${Object.keys(catalog.groups).length} groups`,
    );
  }),
);
