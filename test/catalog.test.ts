import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AliasFileSchema, loadCatalog } from '../src/catalog.ts';

const catalog = loadCatalog();

function readCatalogFile(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../catalog/${name}`, import.meta.url), 'utf8'));
}

const aliases = AliasFileSchema.parse(readCatalogFile('aws.aliases.json'));
const shapes = z
  .object({ icons: z.record(z.string(), z.unknown()), groups: z.record(z.string(), z.unknown()) })
  .parse(readCatalogFile('aws.json'));

describe('catalog', () => {
  it('looks up shapes by "<provider>.<name>"', () => {
    expect(catalog.icon('aws.lambda')?.title).toBe('Lambda');
    expect(catalog.group('aws.vpc')?.title).toBe('VPC');
  });

  it('resolves an alias to the same shape as its full name', () => {
    expect(catalog.icon('aws.s3')).toEqual(catalog.icon('aws.simple_storage_service_s3'));
    expect(catalog.group('aws.az')).toEqual(catalog.group('aws.availability_zone'));
  });

  it('has every alias pointing to an existing shape', () => {
    for (const alias of Object.keys(aliases.icons)) {
      expect(catalog.icon(`aws.${alias}`)).toBeDefined();
    }
    for (const alias of Object.keys(aliases.groups)) {
      expect(catalog.group(`aws.${alias}`)).toBeDefined();
    }
  });

  it('has no alias that hides a shape with the same name', () => {
    expect(Object.keys(aliases.icons).filter((alias) => alias in shapes.icons)).toEqual([]);
    expect(Object.keys(aliases.groups).filter((alias) => alias in shapes.groups)).toEqual([]);
  });

  it('suggests close names for an unknown name', () => {
    expect(catalog.suggest('aws.lamda', 'icon')).toContain('aws.lambda');
  });

  it('searches shapes whose key, title or category contain every word', () => {
    const names = catalog.search('elasticache redis').map((result) => result.name);
    expect(names).toContain('aws.elasticache_for_redis');
  });

  it('finds aliases by their short name', () => {
    expect(catalog.search('sqs')).toContainEqual({
      name: 'aws.sqs',
      shape: catalog.icon('aws.simple_queue_service'),
    });
  });
});
