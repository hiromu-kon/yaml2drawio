import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DiagramError } from './load.ts';

/** Protect source files even when an output names them through a symlink or hard link. */
export async function protectInputs(inputs: string[], outputs: string[]): Promise<void> {
  const paths = [...new Set([...inputs, ...outputs])];
  const stats = new Map(
    await Promise.all(paths.map(async (path) => [path, await fileStat(path)] as const)),
  );
  for (const output of outputs) {
    for (const input of inputs) {
      const samePath = resolve(input) === resolve(output);
      const source = stats.get(input);
      const destination = stats.get(output);
      if (
        samePath ||
        (source && destination && source.dev === destination.dev && source.ino === destination.ino)
      ) {
        throw new DiagramError([
          { code: 'unsafe-output', message: `output "${output}" would overwrite input "${input}"` },
        ]);
      }
    }
  }
}

async function fileStat(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
