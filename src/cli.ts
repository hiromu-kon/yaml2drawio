#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCatalog, NAMESPACES } from './catalog.ts';
import { diagnose, type Diagnostic } from './diagnostics.ts';
import { protectInputs } from './output.ts';
import type { DiagramNode } from './model.ts';
import { toDrawio } from './drawio.ts';
import { layoutDiagram } from './layout.ts';
import { DiagramError, formatProblem, loadDiagram } from './load.ts';
import { exportPng } from './png.ts';

const USAGE = `yaml2drawio: describe infrastructure diagrams in YAML and get a laid-out draw.io file

Usage:
  yaml2drawio guide                    how to write the YAML; start here
  yaml2drawio icons <word...>          search icon and group names; add a namespace to narrow (icons gcp storage)
  yaml2drawio build <input.yaml> [options]
  yaml2drawio validate <input.yaml> [options]  check without writing files

Icon namespaces: ${NAMESPACES.join(', ')}

Options for build:
  -o, --output <file>  where to write the .drawio file (default: next to the input)
  --png                also render a PNG with draw.io Desktop

Options for build and validate:
  --strict             exit with 1 when there are warnings
  --fail-unchecked     exit with 1 if any link cannot be checked
  --json               write one JSON report instead of text

  -h, --help           show this help
  -v, --version        show the version`;

const ICON_RESULTS = 20;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      png: { type: 'boolean' },
      strict: { type: 'boolean' },
      'fail-unchecked': { type: 'boolean' },
      json: { type: 'boolean' },
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
  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify({
        ok: false,
        diagnostics: [{ code: 'invalid-arguments', severity: 'error', message }],
        outputs: [],
      }),
    );
  } else {
    console.error(`error: ${message}\n\n${USAGE}`);
  }
  process.exit(1);
}

async function check(input: string, write: boolean): Promise<void> {
  const diagnostics: Diagnostic[] = [];
  const outputs: string[] = [];
  try {
    const diagram = loadDiagram(await readFile(input, 'utf8'), loadCatalog(), dirname(input));
    const layout = layoutDiagram(diagram.root);
    diagnostics.push(...diagnose(diagram, layout, values['fail-unchecked'] ?? false));
    if (write) {
      const output = values.output ?? input.replace(/\.ya?ml$/, '') + '.drawio';
      const png = output.replace(/\.drawio$/, '') + '.png';
      const images: string[] = [];
      const visit = (node: DiagramNode): void => {
        if (node.kind === 'empty') return;
        if (node.kind === 'leaf') {
          if (node.shape.sourcePath) images.push(node.shape.sourcePath);
          return;
        }
        for (const child of node.children) visit(child);
        if (node.kind === 'group') for (const child of node.border) visit(child.node);
      };
      visit(diagram.root);
      await protectInputs([input, ...images], values.png ? [output, png] : [output]);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, toDrawio(diagram, layout));
      outputs.push(output);
      // Keep the artifacts available for inspection even when checks fail.
      if (values.png) {
        await protectInputs([output], [png]);
        await exportPng(output, png);
        outputs.push(png);
      }
    }
  } catch (error) {
    if (error instanceof DiagramError) {
      diagnostics.push(
        ...error.problems.map((problem): Diagnostic => ({
          ...problem,
          code: problem.code ?? 'invalid-input',
          severity: 'error',
        })),
      );
    } else {
      diagnostics.push({
        code: 'io-error',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const ok = !diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === 'error' ||
      (values.strict && diagnostic.severity === 'warning') ||
      (values['fail-unchecked'] && diagnostic.code === 'unchecked-link'),
  );
  if (!ok) process.exitCode = 1;
  if (values.json) {
    console.log(JSON.stringify({ file: input, ok, diagnostics, outputs }));
  } else {
    for (const output of outputs) console.log(`wrote ${output}`);
    for (const diagnostic of diagnostics)
      console.error(
        formatProblem(
          { ...diagnostic, message: `${diagnostic.severity}: ${diagnostic.message}` },
          input,
        ),
      );
    if (!write && ok) console.log(`checked ${input}`);
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
  if (
    command !== 'build' &&
    command !== 'validate' &&
    (values.json ||
      values.strict ||
      values['fail-unchecked'] ||
      values.png ||
      values.output !== undefined)
  )
    fail('build and validate options need a build or validate command');
  switch (command) {
    case undefined:
      console.log(USAGE);
      break;
    case 'guide':
      process.stdout.write(await readFile(new URL('../docs/guide.md', import.meta.url), 'utf8'));
      break;
    case 'icons': {
      const query = args.join(' ');
      const results = loadCatalog().search(query);
      // A long list buries the right name, while listing everything without a query is for browsing
      const shown = query === '' ? results : results.slice(0, ICON_RESULTS);
      for (const { name, shape } of shown) {
        const alias = name === shape.key ? '' : `\t(= ${shape.key})`;
        console.log(`${name}\t${shape.kind}\t${shape.title}${alias}`);
      }
      // Notes go to stderr so that stdout stays one name per line
      if (results.length === 0) {
        console.error(`no icon or group matches "${query}"; try fewer or shorter words`);
        process.exitCode = 1;
      } else if (shown.length < results.length) {
        console.error(
          `${results.length - shown.length} more; add a word to narrow, such as a namespace (${NAMESPACES.join(', ')})`,
        );
      }
      break;
    }
    case 'build':
    case 'validate': {
      const [input] = args;
      if (!input || args.length !== 1) fail(`${command} needs exactly one input file`);
      if (command === 'validate' && (values.output !== undefined || values.png))
        fail('validate does not accept --output or --png');
      await check(input, command === 'build');
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
