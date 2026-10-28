import { LineCounter, isMap, isNode, isScalar, parseDocument, type Document } from 'yaml';
import type { z } from 'zod';
import { styleValue, type Catalog } from './catalog.ts';
import type {
  BorderChild,
  Diagram,
  DiagramNode,
  Endpoint,
  LeafNode,
  Link,
  SourceLocation,
  StackNode,
} from './model.ts';
import {
  DocumentSchema,
  KNOWN_KEYS,
  NODE_BRANCHES,
  POSITIONS,
  type DocumentInput,
  type LeafInput,
  type NodeInput,
  type Position,
} from './schema.ts';
import { closestMatch } from './suggest.ts';

export interface Problem extends Partial<SourceLocation> {
  message: string;
}

export class DiagramError extends Error {
  readonly problems: Problem[];

  constructor(problems: Problem[]) {
    const sorted = problems.toSorted(
      (a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
    );
    super(sorted.map((problem) => formatProblem(problem)).join('\n'));
    this.name = 'DiagramError';
    this.problems = sorted;
  }
}

/** Formats a problem as `file:line:column: message`, the form editors and terminals link to. */
export function formatProblem(problem: Problem, file?: string): string {
  const location =
    problem.line === undefined ? undefined : `${problem.line}:${problem.column ?? 1}`;
  const prefix = [file, location].filter((part) => part !== undefined).join(':');
  return prefix === '' ? problem.message : `${prefix}: ${problem.message}`;
}

type Path = (string | number)[];

class Source {
  readonly #document: Document;
  readonly #lines: LineCounter;

  constructor(document: Document, lines: LineCounter) {
    this.#document = document;
    this.#lines = lines;
  }

  problem(path: Path, message: string): Problem {
    return { message, ...this.locate(path) };
  }

  /** Points at a key rather than its value, for problems about the key itself. */
  keyProblem(path: Path, key: string, message: string): Problem {
    const parent = this.#document.getIn(path, true);
    if (isMap(parent)) {
      const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === key);
      if (pair && isNode(pair.key) && pair.key.range)
        return { message, ...this.#at(pair.key.range[0]) };
    }
    return this.problem([...path, key], message);
  }

  locate(path: Path): SourceLocation | undefined {
    const node = this.#document.getIn(path, true);
    if (isNode(node) && node.range) return this.#at(node.range[0]);
    // A missing key has no node of its own, so point at the closest ancestor that exists
    return path.length > 0 ? this.locate(path.slice(0, -1)) : undefined;
  }

  #at(offset: number): SourceLocation {
    const { line, col } = this.#lines.linePos(offset);
    return { line, column: col };
  }
}

export function loadDiagram(text: string, catalog: Catalog): Diagram {
  const lines = new LineCounter();
  const document = parseDocument(text, { lineCounter: lines, prettyErrors: false });
  if (document.errors.length > 0) {
    throw new DiagramError(
      document.errors.map((error) => {
        const { line, col } = lines.linePos(error.pos[0]);
        return { message: error.message, line, column: col };
      }),
    );
  }

  const source = new Source(document, lines);
  const data: unknown = document.toJS();
  const parsed = DocumentSchema.safeParse(data);
  if (!parsed.success)
    throw new DiagramError(describeIssues(parsed.error.issues, [], data, source));
  return resolve(parsed.data, catalog, source);
}

function describeIssues(
  issues: readonly z.core.$ZodIssue[],
  base: Path,
  data: unknown,
  source: Source,
): Problem[] {
  return issues.flatMap((issue) => {
    const path = [...base, ...issue.path.filter((key) => typeof key !== 'symbol')];
    switch (issue.code) {
      case 'invalid_union':
        return describeUnion(issue.errors, path, data, source);
      case 'unrecognized_keys':
        return issue.keys.map((key) => source.keyProblem(path, key, unknownKey(key)));
      case 'invalid_type':
        if (valueAt(data, path) === undefined) {
          return [source.problem(path, `missing required key "${String(path.at(-1))}"`)];
        }
        return [source.problem(path, `${nameOf(path)}: ${withoutPrefix(issue.message)}`)];
      case 'too_small':
        if (issue.origin === 'array')
          return [source.problem(path, `${nameOf(path)} must not be empty`)];
        return [source.problem(path, `${nameOf(path)}: ${issue.message}`)];
      default:
        return [source.problem(path, `${nameOf(path)}: ${withoutPrefix(issue.message)}`)];
    }
  });
}

// zod reports a union failure with the issues of every branch. Only the branch the author meant is
// useful, so pick it from the shape of the value: a node by its kind key, a link by tuple or object.
function describeUnion(
  branches: readonly (readonly z.core.$ZodIssue[])[],
  path: Path,
  data: unknown,
  source: Source,
): Problem[] {
  const value = valueAt(data, path);
  if (path[0] === 'links' && path.length === 2) {
    return describeIssues(branches[Array.isArray(value) ? 0 : 1] ?? [], path, data, source);
  }

  const kinds = NODE_BRANCHES.map((branch) => `"${branch.key}"`).join(', ');
  if (!isRecord(value))
    return [source.problem(path, `a node must be a mapping with one of ${kinds}`)];
  const index = NODE_BRANCHES.findIndex((branch) => branch.key in value);
  if (index >= 0) return describeIssues(branches[index] ?? [], path, data, source);

  return [
    ...Object.keys(value)
      .filter((key) => !KNOWN_KEYS.has(key))
      .map((key) => source.keyProblem(path, key, unknownKey(key))),
    source.problem(path, `a node needs one of ${kinds}`),
  ];
}

function unknownKey(key: string): string {
  const hint = closestMatch(key, KNOWN_KEYS);
  return `unknown key "${key}"${hint === undefined ? '' : ` (did you mean "${hint}"?)`}`;
}

function nameOf(path: Path): string {
  const last = path.at(-1);
  return typeof last === 'number' ? `item ${last + 1}` : `"${last ?? 'document'}"`;
}

function withoutPrefix(message: string): string {
  return message.replace(/^Invalid (input|option): /, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueAt(data: unknown, path: Path): unknown {
  let current = data;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isRecord(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

/** Where a node sits: inside a group, whose layer its children share, or outside it on a layer. */
interface Place {
  inGroup: boolean;
  layer: string | undefined;
}

function resolve(input: DocumentInput, catalog: Catalog, source: Source): Diagram {
  const problems: Problem[] = [];
  const ids = new Map<string, Problem>();
  let groupCount = 0;

  const layers = input.layers ?? [];
  for (const [index, name] of layers.entries()) {
    if (layers.indexOf(name) !== index) {
      problems.push(source.problem(['layers', index], `duplicate layer "${name}"`));
    }
  }
  // draw.io stacks later layers on top, and Background, which holds everything without a layer,
  // lies below them all
  const height = (layer: string | undefined) => (layer === undefined ? -1 : layers.indexOf(layer));
  const checkLayer = (layer: string, path: Path): string | undefined => {
    if (layers.includes(layer)) return layer;
    const hint = closestMatch(layer, layers);
    const advice =
      hint !== undefined
        ? `did you mean "${hint}"?`
        : layers.length > 0
          ? `declared layers: ${layers.join(', ')}`
          : 'declare it in layers';
    problems.push(source.problem(path, `unknown layer "${layer}" (${advice})`));
    return undefined;
  };
  // The layer each leaf and group is drawn on, which for those inside a group is the group's
  const nodeLayers = new Map<string, string | undefined>();
  const layerOf = (node: { layer?: string | undefined }, path: Path, place: Place) => {
    if (node.layer === undefined) return place.layer;
    if (place.inGroup) {
      problems.push(
        source.problem(
          [...path, 'layer'],
          'layer works only outside groups; the children of a group share its layer',
        ),
      );
      return place.layer;
    }
    return checkLayer(node.layer, [...path, 'layer']) ?? place.layer;
  };

  const claimId = (id: string, path: Path) => {
    const first = ids.get(id);
    if (first === undefined) {
      ids.set(id, source.problem(path, ''));
      return;
    }
    const where =
      first.line === undefined ? '' : ` (first defined at ${first.line}:${first.column})`;
    problems.push(source.problem(path, `duplicate id "${id}"${where}`));
  };

  const unknown = (kind: 'icon' | 'group', key: string, path: Path): undefined => {
    const suggestions = catalog.suggest(key, kind);
    const hint = suggestions.length > 0 ? ` (did you mean ${suggestions.join(', ')}?)` : '';
    problems.push(source.problem(path, `unknown ${kind} "${key}"${hint}`));
    return undefined;
  };

  const toLeaf = (node: LeafInput, path: Path, place: Place): LeafNode | undefined => {
    claimId(node.id, [...path, 'id']);
    const layer = layerOf(node, path, place);
    nodeLayers.set(node.id, layer);
    const shape = catalog.icon(node.icon);
    if (!shape) return unknown('icon', node.icon, [...path, 'icon']);
    return {
      kind: 'leaf',
      id: node.id,
      shape,
      label: node.label ?? shape.title,
      layer: place.inGroup ? undefined : layer,
    };
  };

  const toNode = (node: NodeInput, path: Path, place: Place): DiagramNode | undefined => {
    if ('icon' in node) return toLeaf(node, path, place);
    if ('group' in node) {
      const id = node.id ?? `group-${++groupCount}`;
      if (node.id !== undefined) claimId(id, [...path, 'id']);
      const layer = layerOf(node, path, place);
      nodeLayers.set(id, layer);
      const inside: Place = { inGroup: true, layer };
      const border = POSITIONS.flatMap((position): BorderChild[] => {
        const leaf = node.border?.[position];
        const resolved = leaf && toLeaf(leaf, [...path, 'border', position], inside);
        return resolved ? [{ position, node: resolved }] : [];
      });
      const shape = catalog.group(node.group);
      const children = toNodes(node.children ?? [], [...path, 'children'], inside);
      if (!shape) return unknown('group', node.group, [...path, 'group']);
      if (node.clear_label && styleValue(shape.style, 'align') !== 'left') {
        problems.push(
          source.problem(
            [...path, 'clear_label'],
            `clear_label needs a label at the top left, but "${node.group}" centers its label`,
          ),
        );
      }
      return {
        kind: 'group',
        id,
        shape,
        label: node.label ?? shape.title,
        direction: node.direction ?? 'horizontal',
        align: node.align ?? 'center',
        border,
        clearLabel: node.clear_label ?? false,
        layer: place.inGroup ? undefined : layer,
        children,
      };
    }
    const [key, direction, children] =
      'row' in node
        ? (['row', 'horizontal', node.row] as const)
        : (['column', 'vertical', node.column] as const);
    return {
      kind: 'stack',
      direction,
      align: node.align ?? 'center',
      children: toNodes(children, [...path, key], { ...place, layer: layerOf(node, path, place) }),
    };
  };

  const toNodes = (nodes: NodeInput[], path: Path, place: Place): DiagramNode[] =>
    nodes
      .map((node, index) => toNode(node, [...path, index], place))
      .filter((node) => node !== undefined);

  const root: StackNode = {
    kind: 'stack',
    direction: input.direction ?? 'horizontal',
    align: 'center',
    children: toNodes(input.nodes, ['nodes'], { inGroup: false, layer: undefined }),
  };

  const toEndpoint = (text: string, path: Path): Endpoint => {
    const [id = '', position] = text.split('.');
    if (!ids.has(id)) problems.push(source.problem(path, `unknown id "${id}" in link "${text}"`));
    return { id, position: POSITIONS.find((p): p is Position => p === position) };
  };

  // A line below the layer of an end would be covered by that layer's boxes, so it goes on the
  // upper layer of its ends unless it names a layer above both
  const linkLayer = (ends: Endpoint[], own: string | undefined, path: Path, text: string) => {
    const upper = ends
      .map(({ id }) => nodeLayers.get(id))
      .reduce((a, b) => (height(b) > height(a) ? b : a));
    if (own === undefined) return upper;
    const layer = checkLayer(own, [...path, 'layer']);
    if (layer === undefined || height(layer) >= height(upper)) return layer;
    const end = ends.find(({ id }) => nodeLayers.get(id) === upper)?.id ?? '';
    problems.push(
      source.problem(
        [...path, 'layer'],
        `link "${text}" is on layer "${layer}", below layer "${upper}" of "${end}", whose boxes would cover it`,
      ),
    );
    return upper;
  };

  const links = (input.links ?? []).map((link, index): Link => {
    const id = `link-${index + 1}`;
    const path = ['links', index];
    if (Array.isArray(link)) {
      const from = toEndpoint(link[0], [...path, 0]);
      const to = toEndpoint(link[1], [...path, 1]);
      return {
        id,
        from,
        to,
        label: '',
        dashed: false,
        arrow: 'end',
        route: 'auto',
        layer: linkLayer([from, to], undefined, path, link.join(' -> ')),
        location: source.locate(path),
      };
    }
    const from = toEndpoint(link.from, [...path, 'from']);
    const to = toEndpoint(link.to, [...path, 'to']);
    return {
      id,
      from,
      to,
      label: link.label ?? '',
      dashed: link.style === 'dashed',
      arrow: link.arrow ?? 'end',
      route: link.route ?? 'auto',
      layer: linkLayer([from, to], link.layer, path, `${link.from} -> ${link.to}`),
      location: source.locate(path),
    };
  });

  if (problems.length > 0) throw new DiagramError(problems);
  return { title: input.title ?? 'Diagram', layers, root, links };
}
