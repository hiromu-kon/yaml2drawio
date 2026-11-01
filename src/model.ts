import type { Shape } from './catalog.ts';
import type { Position } from './schema.ts';

export type Direction = 'vertical' | 'horizontal';
export type Align = 'start' | 'center' | 'end' | 'expand';

export interface LeafNode {
  kind: 'leaf';
  id: string;
  shape: Shape;
  label: string;
  /** Set only outside groups; the children of a group share its layer. */
  layer?: string | undefined;
}

export interface BorderChild {
  position: Position;
  node: LeafNode;
}

export interface GroupNode {
  kind: 'group';
  id: string;
  shape: Shape;
  label: string;
  direction: Direction;
  align: Align;
  border: BorderChild[];
  clearLabel: boolean;
  /** Set only outside groups; the children of a group share its layer. */
  layer?: string | undefined;
  children: DiagramNode[];
}

export interface StackNode {
  kind: 'stack';
  direction: Direction;
  align: Align;
  children: DiagramNode[];
}

/** An empty slot the size of an icon, so that icons in rows of different lengths line up. */
export interface EmptyNode {
  kind: 'empty';
}

export type DiagramNode = LeafNode | GroupNode | StackNode | EmptyNode;

export interface Endpoint {
  id: string;
  position: Position | undefined;
}

/** Where something is written in the YAML, so that messages about it can point there. */
export interface SourceLocation {
  line: number;
  column: number;
}

export interface Link {
  id: string;
  from: Endpoint;
  to: Endpoint;
  label: string;
  dashed: boolean;
  arrow: 'end' | 'start' | 'both' | 'none';
  route: 'auto' | 'drawio';
  /** Undefined for draw.io's Background layer. */
  layer: string | undefined;
  location: SourceLocation | undefined;
}

export interface Diagram {
  title: string;
  /** draw.io layers above Background, bottom first. */
  layers: string[];
  root: StackNode;
  links: Link[];
}
