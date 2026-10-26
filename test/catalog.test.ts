import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AliasFileSchema, loadCatalog } from '../src/catalog.ts';

const catalog = loadCatalog();

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
    const aliases = AliasFileSchema.parse(
      JSON.parse(readFileSync(new URL('../catalog/aws.aliases.json', import.meta.url), 'utf8')),
    );
    for (const alias of Object.keys(aliases.icons)) {
      expect(catalog.icon(`aws.${alias}`)).toBeDefined();
    }
    for (const alias of Object.keys(aliases.groups)) {
      expect(catalog.group(`aws.${alias}`)).toBeDefined();
    }
  });

  it('suggests close names for an unknown name', () => {
    expect(catalog.suggest('aws.lamda', 'icon')).toContain('aws.lambda');
  });

  it('searches shapes whose key, title or category contain every word', () => {
    const keys = catalog.search('elasticache redis').map((shape) => shape.key);
    expect(keys).toContain('aws.elasticache_for_redis');
  });
});
