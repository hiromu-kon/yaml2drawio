import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { rankByCloseness } from './suggest.ts';

export type ShapeKind = 'service' | 'resource' | 'group';

export interface Shape {
  key: string;
  title: string;
  category: string;
  kind: ShapeKind;
  style: string;
  width: number;
  height: number;
  /** Style of the icon at the top left of a group, drawn as a cell of its own. */
  badge?: string;
}

const ShapeEntrySchema = z.object({
  title: z.string(),
  category: z.string(),
  kind: z.enum(['service', 'resource', 'group']),
  style: z.string(),
  width: z.number(),
  height: z.number(),
});

const ProviderFileSchema = z.object({
  icons: z.record(z.string(), ShapeEntrySchema),
  groups: z.record(z.string(), ShapeEntrySchema),
});

export const AliasFileSchema = z.object({
  icons: z.record(z.string(), z.string()),
  groups: z.record(z.string(), z.string()),
});

const GroupFileSchema = z.record(
  z.string(),
  z.object({
    title: z.string(),
    style: z.string(),
    /** An icon of the same namespace to put at the top left. */
    icon: z.string().optional(),
    /** Where the colors come from. */
    source: z.string(),
  }),
);

// Like the AWS groups: the label at the top left, after the icon when there is one
const GROUP_STYLE =
  'html=1;whiteSpace=wrap;container=1;collapsible=0;recursiveResize=0;verticalAlign=top;align=left;fontSize=12;fontStyle=0;';

/** A name to write in a diagram, which may be an alias, and the shape it resolves to. */
export interface SearchResult {
  name: string;
  shape: Shape;
}

export interface Catalog {
  icon(key: string): Shape | undefined;
  group(key: string): Shape | undefined;
  /** Every name that resolves to a shape, aliases included. */
  names(type: 'icon' | 'group'): string[];
  suggest(key: string, type: 'icon' | 'group'): string[];
  search(query: string): SearchResult[];
}

/**
 * Name prefixes, each with a catalog/<namespace>.json of shapes extracted from draw.io, and
 * optionally a catalog/<namespace>.aliases.json of short names and a catalog/<namespace>.groups.json
 * of groups draw.io lacks.
 */
export const NAMESPACES = ['aws', 'gcp', 'azure', 'k8s', 'general', 'network'] as const;

export function styleValue(style: string, key: string): string | undefined {
  return style
    .split(';')
    .map((entry) => entry.split('='))
    .findLast(([name]) => name === key)?.[1];
}

function readCatalogFile(name: string): unknown {
  const url = new URL(`../catalog/${name}`, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : undefined;
}

function toShapes(
  provider: string,
  entries: Record<string, z.infer<typeof ShapeEntrySchema>>,
): Map<string, Shape> {
  return new Map(
    Object.entries(entries).map(([name, entry]) => {
      const key = `${provider}.${name}`;
      return [key, { key, ...entry }];
    }),
  );
}

function groupShape(
  key: string,
  entry: z.infer<typeof GroupFileSchema>[string],
  badge: Shape | undefined,
): Shape {
  return {
    key,
    title: entry.title,
    category: 'Groups',
    kind: 'group',
    style: `${GROUP_STYLE}${entry.style}spacingLeft=${badge ? 30 : 10};`,
    width: 130,
    height: 130,
    ...(badge && { badge: badge.style }),
  };
}

function resolve(
  map: Map<string, Shape>,
  aliasMap: Map<string, string>,
  key: string,
): Shape | undefined {
  return map.get(aliasMap.get(key) ?? key);
}

export function loadCatalog(): Catalog {
  const icons = new Map<string, Shape>();
  const groups = new Map<string, Shape>();
  const aliases = { icon: new Map<string, string>(), group: new Map<string, string>() };

  for (const namespace of NAMESPACES) {
    const shapeFile = readCatalogFile(`${namespace}.json`);
    if (shapeFile !== undefined) {
      const file = ProviderFileSchema.parse(shapeFile);
      for (const [key, shape] of toShapes(namespace, file.icons)) icons.set(key, shape);
      for (const [key, shape] of toShapes(namespace, file.groups)) groups.set(key, shape);
    }
    const aliasFile = readCatalogFile(`${namespace}.aliases.json`);
    if (aliasFile !== undefined) {
      const file = AliasFileSchema.parse(aliasFile);
      for (const [alias, name] of Object.entries(file.icons)) {
        aliases.icon.set(`${namespace}.${alias}`, `${namespace}.${name}`);
      }
      for (const [alias, name] of Object.entries(file.groups)) {
        aliases.group.set(`${namespace}.${alias}`, `${namespace}.${name}`);
      }
    }
    const groupFile = readCatalogFile(`${namespace}.groups.json`);
    if (groupFile !== undefined) {
      for (const [name, entry] of Object.entries(GroupFileSchema.parse(groupFile))) {
        const key = `${namespace}.${name}`;
        let badge: Shape | undefined;
        if (entry.icon !== undefined) {
          badge = resolve(icons, aliases.icon, `${namespace}.${entry.icon}`);
          if (!badge) throw new Error(`${key}: no icon ${namespace}.${entry.icon}`);
        }
        groups.set(key, groupShape(key, entry, badge));
      }
    }
  }

  return {
    icon: (key) => resolve(icons, aliases.icon, key),
    group: (key) => resolve(groups, aliases.group, key),
    names(type) {
      const names =
        type === 'icon'
          ? [...icons.keys(), ...aliases.icon.keys()]
          : [...groups.keys(), ...aliases.group.keys()];
      return names.toSorted();
    },
    suggest(key, type) {
      return rankByCloseness(key, this.names(type)).slice(0, 3);
    },
    search(query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = ({ name, shape }: SearchResult) => {
        const text = `${name} ${shape.title} ${shape.category}`.toLowerCase();
        return words.every((word) => text.includes(word));
      };
      // A word like "internet" is also part of a category ("Internet of Things"), so the names that
      // match best come first
      const phrase = words.join('_');
      const rank = ({ name, shape }: SearchResult) => {
        const short = name.slice(name.indexOf('.') + 1);
        if (short === phrase) return 0;
        if (short.startsWith(phrase)) return 1;
        if (words.every((word) => short.includes(word))) return 2;
        if (words.every((word) => shape.title.toLowerCase().includes(word))) return 3;
        return 4;
      };
      return [...namesWithShapes(groups, aliases.group), ...namesWithShapes(icons, aliases.icon)]
        .filter(matches)
        .toSorted((a, b) => rank(a) - rank(b));
    },
  };
}

function namesWithShapes(shapes: Map<string, Shape>, aliases: Map<string, string>): SearchResult[] {
  return [
    ...[...shapes.values()].map((shape) => ({ name: shape.key, shape })),
    ...[...aliases].flatMap(([alias, key]) => {
      const shape = shapes.get(key);
      return shape ? [{ name: alias, shape }] : [];
    }),
  ].toSorted((a, b) => a.name.localeCompare(b.name));
}
