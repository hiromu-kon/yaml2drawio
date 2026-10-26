import { loadCatalog } from '../src/catalog.ts';
import { DiagramError, loadDiagram } from '../src/load.ts';
import type { Diagram } from '../src/model.ts';

export const catalog = loadCatalog();

export function load(source: string): Diagram {
  return loadDiagram(source, catalog);
}

export function problemsOf(source: string): string[] {
  try {
    load(source);
  } catch (error) {
    if (error instanceof DiagramError) return error.problems;
    throw error;
  }
  throw new Error('expected the diagram to be rejected');
}
