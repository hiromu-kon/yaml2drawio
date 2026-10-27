import type { Shape } from './catalog.ts';
import type { Position } from './schema.ts';

export type Direction = 'vertical' | 'horizontal';
export type Align = 'start' | 'center' | 'end' | 'expand';

export interface LeafNode {
  kind: 'leaf';
  id: string;
  shape: Shape;
  label: string;
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
  children: DiagramNode[];
}

export interface StackNode {
  kind: 'stack';
  direction: Direction;
  align: Align;
  children: DiagramNode[];
}

export type DiagramNode = LeafNode | GroupNode | StackNode;

export interface Endpoint {
  id: string;
  position: Position | undefined;
}

export interface Link {
  id: string;
  from: Endpoint;
  to: Endpoint;
  label: string;
  dashed: boolean;
  arrow: 'end' | 'start' | 'both' | 'none';
  route: 'auto' | 'drawio';
}

export interface Diagram {
  title: string;
  root: StackNode;
  links: Link[];
}
