import { z } from 'zod';

export const POSITIONS = [
  'n',
  'nne',
  'ne',
  'ene',
  'e',
  'ese',
  'se',
  'sse',
  's',
  'ssw',
  'sw',
  'wsw',
  'w',
  'wnw',
  'nw',
  'nnw',
] as const;
export type Position = (typeof POSITIONS)[number];

const Id = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*$/,
    'id must start with a letter and contain only letters, digits, "_" or "-"',
  );
// YAML reads a bare 8080 or 1.0 as a number, which is still meant as text on the diagram
const Label = z.union([z.string(), z.number().transform(String)]);
const Direction = z.enum(['vertical', 'horizontal']);
const Align = z.enum(['start', 'center', 'end', 'expand']);

const describeDirection = 'How the children are laid out. Defaults to horizontal.';
const describeAlign =
  'How the children line up across the direction. expand gives them all the same size. Defaults to center.';

const LeafSchema = z
  .strictObject({
    id: Id.describe('Unique id, used by links.'),
    icon: z
      .string()
      .describe('Icon from the catalog, such as aws.ecs. Search with `yaml2drawio icons <word>`.'),
    label: Label.optional().describe("Text under the icon. Defaults to the icon's title."),
  })
  .meta({ id: 'Leaf', description: 'An icon.' });

export type LeafInput = z.infer<typeof LeafSchema>;

export interface GroupInput {
  id?: string | undefined;
  group: string;
  label?: string | undefined;
  direction?: z.infer<typeof Direction> | undefined;
  align?: z.infer<typeof Align> | undefined;
  border?: Partial<Record<Position, LeafInput>> | undefined;
  children?: NodeInput[] | undefined;
}

export interface RowInput {
  row: NodeInput[];
  align?: z.infer<typeof Align> | undefined;
}

export interface ColumnInput {
  column: NodeInput[];
  align?: z.infer<typeof Align> | undefined;
}

export type NodeInput = LeafInput | GroupInput | RowInput | ColumnInput;

const GroupObject = z.strictObject({
  id: Id.optional().describe('Unique id, needed only to link to the group.'),
  group: z.string().describe('Group style, such as aws.vpc, aws.az or aws.private_subnet.'),
  label: Label.optional().describe("Title of the group. Defaults to the style's title."),
  direction: Direction.optional().describe(describeDirection),
  align: Align.optional().describe(describeAlign),
  border: z
    .partialRecord(z.enum(POSITIONS), LeafSchema)
    .optional()
    .describe('Icons placed on the edge of the group, keyed by position (n, ne, e, ...).'),
  get children() {
    return z
      .array(NodeSchema)
      .optional()
      .describe(
        'What the group contains. Leave it out for an empty box, such as an unused subnet.',
      );
  },
});
const GroupSchema: z.ZodType<GroupInput> = GroupObject.meta({
  id: 'Group',
  description: 'A box around other nodes, such as a VPC or a subnet.',
});

const RowObject = z.strictObject({
  align: Align.optional().describe(describeAlign),
  get row() {
    return z.array(NodeSchema).min(1).describe('Nodes laid out left to right.');
  },
});
const RowSchema: z.ZodType<RowInput> = RowObject.meta({
  id: 'Row',
  description: 'Nodes laid out left to right without a box.',
});

const ColumnObject = z.strictObject({
  align: Align.optional().describe(describeAlign),
  get column() {
    return z.array(NodeSchema).min(1).describe('Nodes laid out top to bottom.');
  },
});
const ColumnSchema: z.ZodType<ColumnInput> = ColumnObject.meta({
  id: 'Column',
  description: 'Nodes laid out top to bottom without a box.',
});

// Keep the order in sync with NODE_BRANCHES, which load.ts uses to pick the branch a node was
// meant to match when reporting errors
export const NodeSchema: z.ZodType<NodeInput> = z
  .union([LeafSchema, GroupSchema, RowSchema, ColumnSchema])
  .meta({ id: 'Node', description: 'An icon, a group, a row or a column.' });
export const NODE_BRANCHES = [
  { key: 'icon', keys: Object.keys(LeafSchema.shape) },
  { key: 'group', keys: Object.keys(GroupObject.shape) },
  { key: 'row', keys: Object.keys(RowObject.shape) },
  { key: 'column', keys: Object.keys(ColumnObject.shape) },
] as const;

const Endpoint = z
  .string()
  .regex(
    new RegExp(`^[A-Za-z][A-Za-z0-9_-]*(\\.(${POSITIONS.join('|')}))?$`),
    `endpoint must be "<id>" or "<id>.<position>" (position: ${POSITIONS.join(', ')})`,
  )
  .meta({
    id: 'Endpoint',
    description:
      'An id, optionally followed by the side the line leaves or enters, such as alb.s (n, ne, e, se, s, sw, w, nw and the points between them).',
  });

const LinkObject = z.strictObject({
  from: Endpoint,
  to: Endpoint,
  label: Label.optional().describe('Text on the line.'),
  style: z.enum(['solid', 'dashed']).optional().describe('Defaults to solid.'),
  arrow: z
    .enum(['end', 'start', 'both', 'none'])
    .optional()
    .describe('Which ends get an arrowhead. Defaults to end.'),
  route: z
    .enum(['auto', 'drawio'])
    .optional()
    .describe(
      'auto bends the line in the gaps around groups; drawio leaves the whole route to draw.io. Defaults to auto.',
    ),
});

// The tuple comes first; load.ts relies on this order when reporting errors
const LinkSchema = z
  .union([z.tuple([Endpoint, Endpoint]), LinkObject])
  .meta({ id: 'Link', description: 'A line: [from, to], or an object for a label or style.' });

export const DocumentSchema = z
  .strictObject({
    title: z.string().optional().describe('Name of the draw.io page.'),
    direction: Direction.optional().describe(describeDirection),
    nodes: z.array(NodeSchema).min(1).describe('What the diagram contains.'),
    links: z.array(LinkSchema).optional().describe('Lines between ids.'),
  })
  .meta({ title: 'yaml2drawio diagram' });

export type DocumentInput = z.infer<typeof DocumentSchema>;

/** Every key the schema accepts anywhere, used to suggest a fix for a misspelled key. */
export const KNOWN_KEYS: ReadonlySet<string> = new Set([
  ...NODE_BRANCHES.flatMap((branch) => branch.keys),
  ...Object.keys(LinkObject.shape),
  ...Object.keys(DocumentSchema.shape),
]);
