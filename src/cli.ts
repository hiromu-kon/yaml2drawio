#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCatalog } from './catalog.ts';
import { toDrawio } from './drawio.ts';
import { layoutDiagram } from './layout.ts';
import { DiagramError, formatProblem, loadDiagram } from './load.ts';
import { exportPng } from './png.ts';

const USAGE = `Usage:
  yaml2drawio build <input.yaml> [-o <output.drawio>] [--png]
  yaml2drawio icons <query...>`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', short: 'o' },
    png: { type: 'boolean' },
  },
});
const [command, ...args] = positionals;

async function build(input: string): Promise<void> {
  const output = values.output ?? input.replace(/\.ya?ml$/, '') + '.drawio';
  const diagram = loadDiagram(await readFile(input, 'utf8'), loadCatalog());
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, toDrawio(diagram, layoutDiagram(diagram.root)));
  console.log(`wrote ${output}`);
  if (values.png) {
    const png = output.replace(/\.drawio$/, '') + '.png';
    await exportPng(output, png);
    console.log(`wrote ${png}`);
  }
}

switch (command) {
  case 'icons': {
    for (const { name, shape } of loadCatalog().search(args.join(' '))) {
      const alias = name === shape.key ? '' : `\t(= ${shape.key})`;
      console.log(`${name}\t${shape.kind}\t${shape.title}${alias}`);
    }
    break;
  }
  case 'build': {
    const [input] = args;
    if (!input) {
      console.error(USAGE);
      process.exitCode = 1;
      break;
    }
    try {
      await build(input);
    } catch (error) {
      if (!(error instanceof DiagramError)) throw error;
      for (const problem of error.problems) console.error(formatProblem(problem, input));
      process.exitCode = 1;
    }
    break;
  }
  default:
    console.log(USAGE);
}
