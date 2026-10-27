#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCatalog, NAMESPACES } from './catalog.ts';
import { findCrossings, linkText } from './crossings.ts';
import { toDrawio } from './drawio.ts';
import { layoutDiagram } from './layout.ts';
import { DiagramError, formatProblem, loadDiagram } from './load.ts';
import { exportPng } from './png.ts';

const USAGE = `yaml2drawio: describe infrastructure diagrams in YAML and get a laid-out draw.io file

Usage:
  yaml2drawio guide                    how to write the YAML; start here
  yaml2drawio icons <word...>          search icon and group names (${NAMESPACES.join(', ')})
  yaml2drawio build <input.yaml> [options]

Options for build:
  -o, --output <file>  where to write the .drawio file (default: next to the input)
  --png                also render a PNG with draw.io Desktop
  --strict             exit with 1 when a line crosses an icon or a label

  -h, --help           show this help
  -v, --version        show the version`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      png: { type: 'boolean' },
      strict: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (error) {
  // parseArgs explains a bad option well, but as an uncaught error with a stack trace
  fail(error instanceof Error ? error.message : String(error));
}
const { positionals, values } = parsed;
const [command, ...args] = positionals;

function fail(message: string): never {
  console.error(`error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

async function build(input: string): Promise<void> {
  const output = values.output ?? input.replace(/\.ya?ml$/, '') + '.drawio';
  const diagram = loadDiagram(await readFile(input, 'utf8'), loadCatalog());
  const layout = layoutDiagram(diagram.root);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, toDrawio(diagram, layout));
  console.log(`wrote ${output}`);
  // The file is still written, so the diagram can be looked at while fixing the warnings
  const { crossings, unchecked } = findCrossings(diagram, layout);
  for (const crossing of crossings) {
    console.error(formatProblem({ ...crossing, message: `warning: ${crossing.message}` }, input));
  }
  // Dropping the sides would otherwise be a silent way to get rid of warnings
  for (const link of unchecked) {
    const message = `note: link ${linkText(link)} is not checked for crossings; give both ends a side, such as alb.s`;
    console.error(formatProblem({ message, ...link.location }, input));
  }
  if (values.strict && crossings.length > 0) process.exitCode = 1;
  if (values.png) {
    const png = output.replace(/\.drawio$/, '') + '.png';
    await exportPng(output, png);
    console.log(`wrote ${png}`);
  }
}

if (values.help) {
  console.log(USAGE);
} else if (values.version) {
  console.log(await readPackageVersion());
} else {
  await run();
}

async function run(): Promise<void> {
  switch (command) {
    case undefined:
      console.log(USAGE);
      break;
    case 'guide':
      process.stdout.write(await readFile(new URL('../docs/guide.md', import.meta.url), 'utf8'));
      break;
    case 'icons': {
      for (const { name, shape } of loadCatalog().search(args.join(' '))) {
        const alias = name === shape.key ? '' : `\t(= ${shape.key})`;
        console.log(`${name}\t${shape.kind}\t${shape.title}${alias}`);
      }
      break;
    }
    case 'build': {
      const [input] = args;
      if (!input) fail('build needs an input file');
      if (!existsSync(input)) fail(`${input} does not exist`);
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
      fail(`unknown command "${command}"`);
  }
}

async function readPackageVersion(): Promise<string> {
  const pkg: unknown = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  return typeof pkg === 'object' && pkg !== null && 'version' in pkg ? String(pkg.version) : '';
}
