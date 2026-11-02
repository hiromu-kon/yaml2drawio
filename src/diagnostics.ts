import { findCrossings, linkText } from './crossings.ts';
import type { Layout } from './layout.ts';
import type { Problem } from './load.ts';
import type { Diagram } from './model.ts';

export interface Diagnostic extends Problem {
  code: string;
  severity: 'error' | 'warning' | 'note';
}

export function diagnose(diagram: Diagram, layout: Layout, failUnchecked: boolean): Diagnostic[] {
  const { crossings, unchecked } = findCrossings(diagram, layout);
  const diagnostics: Diagnostic[] = [];
  for (const problem of crossings)
    diagnostics.push({ ...problem, code: problem.code ?? 'crossing', severity: 'warning' });
  for (const link of unchecked)
    diagnostics.push({
      code: 'unchecked-link',
      severity: failUnchecked ? 'warning' : 'note',
      linkId: link.id,
      message: `link ${linkText(link)} is not checked for crossings; give both ends a side, such as alb.s`,
      ...link.location,
    });
  return diagnostics;
}
