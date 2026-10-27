import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AliasFileSchema, loadCatalog, NAMESPACES } from '../src/catalog.ts';

const catalog = loadCatalog();

function readCatalogFile(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../catalog/${name}`, import.meta.url), 'utf8'));
}

const ShapeNamesSchema = z.object({
  icons: z.record(z.string(), z.unknown()),
  groups: z.record(z.string(), z.unknown()),
});
// A namespace may have only shapes or only aliases
function readOptional(name: string): unknown {
  const url = new URL(`../catalog/${name}`, import.meta.url);
  return existsSync(url) ? readCatalogFile(name) : { icons: {}, groups: {} };
}

const files = NAMESPACES.map((namespace) => ({
  namespace,
  aliases: AliasFileSchema.parse(readOptional(`${namespace}.aliases.json`)),
  shapes: ShapeNamesSchema.parse(readOptional(`${namespace}.json`)),
}));

describe('catalog', () => {
  it('looks up shapes by "<provider>.<name>"', () => {
    expect(catalog.icon('aws.lambda')?.title).toBe('Lambda');
    expect(catalog.group('aws.vpc')?.title).toBe('VPC');
  });

  it('resolves an alias to the same shape as its full name', () => {
    expect(catalog.icon('aws.s3')).toEqual(catalog.icon('aws.simple_storage_service_s3'));
    expect(catalog.group('aws.az')).toEqual(catalog.group('aws.availability_zone'));
  });

  it.each(files)(
    'has every alias in $namespace pointing to an existing shape',
    ({ namespace, aliases }) => {
      const qualify = (alias: string) => `${namespace}.${alias}`;
      expect(Object.keys(aliases.icons).filter((alias) => !catalog.icon(qualify(alias)))).toEqual(
        [],
      );
      expect(Object.keys(aliases.groups).filter((alias) => !catalog.group(qualify(alias)))).toEqual(
        [],
      );
    },
  );

  it.each(files)(
    'has no alias in $namespace that hides a shape with the same name',
    ({ aliases, shapes }) => {
      expect(Object.keys(aliases.icons).filter((alias) => alias in shapes.icons)).toEqual([]);
      expect(Object.keys(aliases.groups).filter((alias) => alias in shapes.groups)).toEqual([]);
    },
  );

  it('names the provider-neutral icons general.*, whatever library draw.io keeps them in', () => {
    expect(catalog.icon('general.database')).toEqual(catalog.icon('aws.generic_database'));
    expect(catalog.group('general.data_center')).toEqual(
      catalog.group('aws.corporate_data_center'),
    );
  });

  it('has on-premises network equipment under network.*', () => {
    expect(catalog.icon('network.switch')?.style).toContain('shape=mxgraph.networks.switch');
  });

  it('suggests close names for an unknown name', () => {
    expect(catalog.suggest('aws.lamda', 'icon')).toContain('aws.lambda');
  });

  it('searches shapes whose key, title or category contain every word', () => {
    const names = catalog.search('elasticache redis').map((result) => result.name);
    expect(names).toContain('aws.elasticache_for_redis');
  });

  it('lists the names that match best before matches in titles and categories', () => {
    // "internet" is also in the category "Internet of Things", which sorts before it
    const names = catalog.search('internet').map((result) => result.name);
    expect(names[0]).toBe('aws.internet');
    expect(catalog.search('elasticache redis')[0]?.name).toBe('aws.elasticache_for_redis');
  });

  it('finds aliases by their short name', () => {
    expect(catalog.search('sqs')).toContainEqual({
      name: 'aws.sqs',
      shape: catalog.icon('aws.simple_queue_service'),
    });
  });
});
