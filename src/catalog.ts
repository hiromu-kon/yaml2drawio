import { readFileSync } from 'node:fs';
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

export interface Catalog {
  icon(key: string): Shape | undefined;
  group(key: string): Shape | undefined;
  suggest(key: string, type: 'icon' | 'group'): string[];
  search(query: string): Shape[];
}

const PROVIDERS = ['aws'] as const;

function readCatalogFile(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../catalog/${name}`, import.meta.url), 'utf8'));
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

  for (const provider of PROVIDERS) {
    const file = ProviderFileSchema.parse(readCatalogFile(`${provider}.json`));
    const aliasFile = AliasFileSchema.parse(readCatalogFile(`${provider}.aliases.json`));
    for (const [key, shape] of toShapes(provider, file.icons)) icons.set(key, shape);
    for (const [key, shape] of toShapes(provider, file.groups)) groups.set(key, shape);
    for (const [alias, name] of Object.entries(aliasFile.icons)) {
      aliases.icon.set(`${provider}.${alias}`, `${provider}.${name}`);
    }
    for (const [alias, name] of Object.entries(aliasFile.groups)) {
      aliases.group.set(`${provider}.${alias}`, `${provider}.${name}`);
    }
  }

  const resolve = (map: Map<string, Shape>, aliasMap: Map<string, string>, key: string) =>
    map.get(aliasMap.get(key) ?? key);

  return {
    icon: (key) => resolve(icons, aliases.icon, key),
    group: (key) => resolve(groups, aliases.group, key),
    suggest(key, type) {
      const names =
        type === 'icon'
          ? [...icons.keys(), ...aliases.icon.keys()]
          : [...groups.keys(), ...aliases.group.keys()];
      return rankByCloseness(key, names).slice(0, 3);
    },
    search(query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = (shape: Shape) => {
        const text = `${shape.key} ${shape.title} ${shape.category}`.toLowerCase();
        return words.every((word) => text.includes(word));
      };
      return [...groups.values(), ...icons.values()].filter(matches);
    },
  };
}
