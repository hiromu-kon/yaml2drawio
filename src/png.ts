import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const MACOS_APP = '/Applications/draw.io.app/Contents/MacOS/draw.io';

function drawioCommand(): string {
  if (process.env['DRAWIO_CLI']) return process.env['DRAWIO_CLI'];
  return process.platform === 'darwin' && existsSync(MACOS_APP) ? MACOS_APP : 'drawio';
}

/** Renders a .drawio file to PNG with the draw.io Desktop command line. */
export async function exportPng(input: string, output: string): Promise<void> {
  await promisify(execFile)(drawioCommand(), [
    '--export',
    '--format',
    'png',
    '--border',
    '20',
    '--output',
    output,
    input,
  ]);
}
