import { z } from 'zod';
import type { Catalog } from './catalog.ts';
import { DocumentSchema } from './schema.ts';

export const SCHEMA_URL =
  'https://raw.githubusercontent.com/hiromu-kon/yaml2drawio/main/schema.json';

/**
 * JSON Schema for editors. Icon and group names are listed as enums so editors can complete them
 * and flag unknown ones before the diagram is built.
 */
export function buildJsonSchema(catalog: Catalog): Record<string, unknown> {
  const { $schema, ...schema } = z.toJSONSchema(DocumentSchema, {
    target: 'draft-07',
    io: 'input',
  });
  const definitions = isRecord(schema.definitions) ? schema.definitions : {};
  listNames(definitions['Leaf'], 'icon', catalog.names('icon'));
  listNames(definitions['Group'], 'group', catalog.names('group'));
  return { $schema, $id: SCHEMA_URL, ...schema };
}

function listNames(definition: unknown, key: string, names: string[]): void {
  if (!isRecord(definition) || !isRecord(definition['properties'])) return;
  const property = definition['properties'][key];
  if (isRecord(property)) property['enum'] = names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
