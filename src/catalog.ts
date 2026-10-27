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
 * Name prefixes, each with a catalog/<namespace>.json of shapes and, when it has short names, a
 * catalog/<namespace>.aliases.json.
 */
export const NAMESPACES = ['aws', 'gcp', 'azure', 'k8s', 'general', 'network'] as const;

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
  }

  const resolve = (map: Map<string, Shape>, aliasMap: Map<string, string>, key: string) =>
    map.get(aliasMap.get(key) ?? key);

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
