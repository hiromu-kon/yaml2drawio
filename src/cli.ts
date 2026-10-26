#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadCatalog } from './catalog.ts';

const USAGE = `Usage:
  yaml2drawio build <input.yaml> [-o <output.drawio>] [--png]
  yaml2drawio icons <query...>`;

const { positionals } = parseArgs({ allowPositionals: true, strict: false });
const [command, ...args] = positionals;

switch (command) {
  case 'icons': {
    const catalog = loadCatalog();
    for (const shape of catalog.search(args.join(' '))) {
      console.log(`${shape.key}\t${shape.kind}\t${shape.title}`);
    }
    break;
  }
  case 'build':
    console.error('build is not implemented yet');
    process.exitCode = 1;
    break;
  case undefined:
  default:
    console.log(USAGE);
}
