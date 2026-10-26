import { LineCounter, parseDocument, isNode, type Document } from 'yaml';
import type { z } from 'zod';
import type { Catalog } from './catalog.ts';
import type { Diagram, DiagramNode, Endpoint, Link, StackNode } from './model.ts';
import {
  DocumentSchema,
  POSITIONS,
  type DocumentInput,
  type NodeInput,
  type Position,
} from './schema.ts';

export class DiagramError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.name = 'DiagramError';
    this.problems = problems;
  }
}

export function loadDiagram(source: string, catalog: Catalog): Diagram {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });
  if (document.errors.length > 0) {
    throw new DiagramError(document.errors.map((error) => error.message));
  }

  const parsed = DocumentSchema.safeParse(document.toJS());
  if (!parsed.success) {
    throw new DiagramError(
      parsed.error.issues.map((issue) => describeIssue(issue, document, lineCounter)),
    );
  }
  return resolve(parsed.data, catalog);
}

function describeIssue(issue: z.core.$ZodIssue, document: Document, lines: LineCounter): string {
  const path = issue.path.filter((key) => typeof key !== 'symbol');
  const node = document.getIn(path, true);
  const location =
    isNode(node) && node.range ? `${formatPosition(lines.linePos(node.range[0]))} ` : '';
  const where = path.length > 0 ? `${path.join('.')}: ` : '';
  return `${location}${where}${issue.message}`;
}

function formatPosition({ line, col }: { line: number; col: number }): string {
  return `${line}:${col}`;
}

function resolve(input: DocumentInput, catalog: Catalog): Diagram {
  const problems: string[] = [];
  const ids = new Set<string>();
  let groupCount = 0;

  const claimId = (id: string) => {
    if (ids.has(id)) problems.push(`duplicate id "${id}"`);
    ids.add(id);
  };

  const unknown = (kind: 'icon' | 'group', key: string): undefined => {
    const suggestions = catalog.suggest(key, kind);
    const hint = suggestions.length > 0 ? ` (did you mean ${suggestions.join(', ')}?)` : '';
    problems.push(`unknown ${kind} "${key}"${hint}`);
    return undefined;
  };

  const toNode = (node: NodeInput): DiagramNode | undefined => {
    if ('icon' in node) {
      claimId(node.id);
      const shape = catalog.icon(node.icon);
      if (!shape) return unknown('icon', node.icon);
      return { kind: 'leaf', id: node.id, shape, label: node.label ?? shape.title };
    }
    if ('group' in node) {
      const id = node.id ?? `group-${++groupCount}`;
      claimId(id);
      if (node.border) problems.push(`group "${id}": border is not supported yet`);
      const shape = catalog.group(node.group);
      const children = toNodes(node.children);
      if (!shape) return unknown('group', node.group);
      return {
        kind: 'group',
        id,
        shape,
        label: node.label ?? shape.title,
        direction: node.direction ?? 'horizontal',
        align: node.align ?? 'center',
        children,
      };
    }
    const [direction, children] =
      'row' in node ? (['horizontal', node.row] as const) : (['vertical', node.column] as const);
    return { kind: 'stack', direction, align: node.align ?? 'center', children: toNodes(children) };
  };

  const toNodes = (nodes: NodeInput[]): DiagramNode[] =>
    nodes.map(toNode).filter((node) => node !== undefined);

  const root: StackNode = {
    kind: 'stack',
    direction: input.direction ?? 'horizontal',
    align: 'center',
    children: toNodes(input.nodes),
  };

  const toEndpoint = (text: string): Endpoint => {
    const [id = '', position] = text.split('.');
    if (!ids.has(id)) problems.push(`link endpoint "${text}" refers to unknown id "${id}"`);
    return { id, position: POSITIONS.find((p): p is Position => p === position) };
  };

  const links = (input.links ?? []).map((link, index): Link => {
    const id = `link-${index + 1}`;
    if (Array.isArray(link)) {
      const [from, to] = link;
      return {
        id,
        from: toEndpoint(from),
        to: toEndpoint(to),
        label: '',
        dashed: false,
        arrow: 'end',
      };
    }
    return {
      id,
      from: toEndpoint(link.from),
      to: toEndpoint(link.to),
      label: link.label ?? '',
      dashed: link.style === 'dashed',
      arrow: link.arrow ?? 'end',
    };
  });

  if (problems.length > 0) throw new DiagramError(problems);
  return { title: input.title ?? 'Diagram', root, links };
}
