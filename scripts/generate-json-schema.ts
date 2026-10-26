// Writes schema.json, the JSON Schema editors use to complete and check diagram files.
//   pnpm schema
import { writeFile } from 'node:fs/promises';
import { loadCatalog } from '../src/catalog.ts';
import { buildJsonSchema } from '../src/json-schema.ts';

const output = new URL('../schema.json', import.meta.url);
await writeFile(output, `${JSON.stringify(buildJsonSchema(loadCatalog()), null, 2)}\n`);
console.log('wrote schema.json');
