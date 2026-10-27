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
  /** Leaves out palettes of things other than icons, such as cards and diagrams. */
  include?: (entry: RawEntry) => boolean;
  kind: (entry: RawEntry) => Kind;
  category: (entry: RawEntry) => string;
  /** The name before any suffix for a clash; the title by default. */
  name?: (entry: RawEntry) => string;
}

// The General Resources palette is AWS's set for things outside AWS, apart from these
const AWS_ONLY_GENERAL = new Set(['All Products', 'General', 'Management Console', 'Marketplace']);
const GENERAL_GROUPS: Record<string, string> = {
  'Generic group': 'generic',
  'Corporate data center': 'data_center',
  'Server contents': 'server_contents',
};

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
    // The GCP2 library has the product icons; GCPIcons has fewer (no Pub/Sub or Vertex AI), and
    // GCP3 only the category and core product icons
    namespace: 'gcp',
    file: 'Sidebar-GCP2.js',
    palette: 'addGCP2Palette',
    include: (entry) => entry.palette.startsWith('GCP Icons / '),
    kind: () => 'service',
    category: (entry) => entry.palette.replace(/^GCP Icons \/ /, ''),
  },
  {
    namespace: 'azure',
    file: 'Sidebar-Azure2.js',
    palette: 'addAzure2Palette',
    kind: () => 'service',
    category: (entry) => entry.palette.replace(/^Azure \/ /, ''),
  },
  {
    namespace: 'k8s',
    file: 'Sidebar-Kubernetes.js',
    palette: 'addKubernetesPalette',
    kind: () => 'resource',
    category: () => 'Kubernetes',
    // Each icon comes plain and with its abbreviation written in it (kubernetesLabel=1)
    name: (entry) =>
      entry.style.includes('kubernetesLabel=1')
        ? `${slug(entry.title)}_labeled`
        : slug(entry.title),
  },
  {
    // Provider-neutral icons and groups. draw.io keeps them in its AWS library, but a diagram of
    // another cloud should not have to call them aws.*
    namespace: 'general',
    file: 'Sidebar-AWS4.js',
    palette: 'addAWS4Palette',
    include: (entry) =>
      entry.palette === 'AWS / General Resources'
        ? !AWS_ONLY_GENERAL.has(entry.title)
        : entry.palette === 'AWS / Groups' && entry.title in GENERAL_GROUPS,
    kind: (entry) => (entry.palette === 'AWS / Groups' ? 'group' : 'resource'),
    category: () => 'General',
    name: (entry) => {
      const group = GENERAL_GROUPS[entry.title];
      if (!group) return slug(entry.title);
      // The two generic groups differ only in being filled
      return group === 'generic' && !entry.style.includes('fillColor=none')
        ? 'generic_filled'
        : group;
    },
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

interface Template {
  style: string;
  width: number;
  height: number;
  value: string;
  title: string;
}

function Sidebar() {}

// Some libraries build composite entries from draw.io's cell classes. Those entries are skipped,
// so the classes only need to accept whatever is done with them.
function anything(): object {
  return new Proxy(function () {}, {
    get: () => anything(),
    apply: () => anything(),
    construct: () => anything(),
  });
}

// Edges, embedded images (a network ring bus) and composites of several cells (product cards) are
// not icons
function skip(): () => null {
  return () => null;
}

function isTemplate(value: unknown): value is Template {
  return (
    (typeof value === 'object' || typeof value === 'function') && value !== null && 'style' in value
  );
}

// Style strings are built by concatenating variables, so extracting them with regular expressions
// would resolve the concatenation incorrectly. Evaluate draw.io's code as is and capture the values
// it registers to the palette.
function evaluateSidebar(source: string, method: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const add = (palette: string, value: unknown): void => {
    if (!isTemplate(value)) return;
    const { title, value: text, style, width, height } = value;
    entries.push({ palette, title: (title || text).replaceAll('\n', ' '), style, width, height });
  };
  Object.assign(Sidebar.prototype, {
    setCurrentSearchEntryLibrary: () => {},
    getTagsForStencil: () => [],
    isEntryVisible: () => true,
    createEdgeTemplateEntry: skip,
    addDataEntry: skip,
    createVertexTemplateFromCells: skip,
    addEntry: (_tags: string, entry: unknown) => entry,
    // A palette filled at once reads each template as an object; one filled lazily calls it, so a
    // template is both
    createVertexTemplateEntry: (
      style: string,
      width: number,
      height: number,
      value: string,
      title: string,
    ) => {
      const template: Template = { style, width, height, value, title };
      return Object.assign(() => template, template);
    },
    addPaletteFunctions: (_id: string, palette: string, _expand: boolean, templates: unknown[]) => {
      for (const template of templates) add(palette, template);
    },
    addPalette: (
      _id: string,
      palette: string,
      _expand: boolean,
      fill: (content: { appendChild: (node: unknown) => void }) => void,
    ) => fill({ appendChild: (node) => add(palette, node) }),
  });

  const context = createContext({
    Sidebar,
    mxConstants: { STYLE_SHAPE: 'shape' },
    mxUtils: { bind: (scope: unknown, fn: (...args: unknown[]) => unknown) => fn.bind(scope) },
    mxCell: anything(),
    mxGeometry: anything(),
    mxPoint: anything(),
  });
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
  { kind: kindOf, category: categoryOf, name: nameOf = (entry) => slug(entry.title) }: Source,
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
    const base = nameOf(entry);
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

// Two sources read the AWS library, so each file is fetched once
const fetched = new Map<string, Promise<string>>();
function fetchSource(url: string): Promise<string> {
  let text = fetched.get(url);
  if (!text) {
    text = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
      return response.text();
    });
    fetched.set(url, text);
  }
  return text;
}

// evaluateSidebar runs synchronously after each fetch, so the sources cannot mix up their entries
await Promise.all(
  SOURCES.map(async (source) => {
    const path = `${SIDEBAR_DIR}/${source.file}`;
    const url = `https://raw.githubusercontent.com/jgraph/drawio/${DRAWIO_TAG}/${path}`;
    const entries = evaluateSidebar(await fetchSource(url), source.palette);
    const catalog = buildCatalog(entries.filter(source.include ?? (() => true)), source);
    await writeFile(
      new URL(`../catalog/${source.namespace}.json`, import.meta.url),
      `${JSON.stringify({ source: { repository: 'jgraph/drawio', tag: DRAWIO_TAG, path }, ...catalog }, null, 2)}\n`,
    );
    console.log(
      `wrote catalog/${source.namespace}.json: ${Object.keys(catalog.icons).length} icons, ${Object.keys(catalog.groups).length} groups`,
    );
  }),
);
