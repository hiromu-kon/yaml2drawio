import { readdirSync, readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildJsonSchema } from '../src/json-schema.ts';
import { catalog } from './helpers.ts';

const schema = buildJsonSchema(catalog);
const validate = new Ajv({ strict: false }).compile(schema);
const examples = new URL('../examples/', import.meta.url);

describe('JSON Schema', () => {
  it('matches schema.json, so the published file is not stale', () => {
    const published: unknown = JSON.parse(
      readFileSync(new URL('../schema.json', import.meta.url), 'utf8'),
    );
    expect(published).toEqual(schema);
  });

  it.each(readdirSync(examples).filter((file) => file.endsWith('.yaml')))(
    'accepts examples/%s',
    (file) => {
      expect(validate(parse(readFileSync(new URL(file, examples), 'utf8')))).toBe(true);
    },
  );

  it('rejects an icon that is not in the catalog', () => {
    expect(validate({ nodes: [{ id: 'fn', icon: 'aws.lamda' }] })).toBe(false);
  });

  it('accepts aliases as icon and group names', () => {
    expect(
      validate({ nodes: [{ group: 'aws.az', children: [{ id: 'q', icon: 'aws.sqs' }] }] }),
    ).toBe(true);
  });

  it('rejects a misspelled key', () => {
    expect(validate({ nodes: [{ id: 'fn', icon: 'aws.lambda', labl: 'x' }] })).toBe(false);
  });
});
