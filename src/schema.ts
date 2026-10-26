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
const Direction = z.enum(['vertical', 'horizontal']);
const Align = z.enum(['start', 'center', 'end', 'expand']);

const LeafSchema = z.strictObject({
  id: Id,
  icon: z.string(),
  label: z.string().optional(),
});

export type LeafInput = z.infer<typeof LeafSchema>;

export interface GroupInput {
  id?: string | undefined;
  group: string;
  label?: string | undefined;
  direction?: z.infer<typeof Direction> | undefined;
  align?: z.infer<typeof Align> | undefined;
  border?: Partial<Record<Position, LeafInput>> | undefined;
  children: NodeInput[];
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

const GroupSchema: z.ZodType<GroupInput> = z.strictObject({
  id: Id.optional(),
  group: z.string(),
  label: z.string().optional(),
  direction: Direction.optional(),
  align: Align.optional(),
  border: z.partialRecord(z.enum(POSITIONS), LeafSchema).optional(),
  get children() {
    return z.array(NodeSchema).min(1);
  },
});

const RowSchema: z.ZodType<RowInput> = z.strictObject({
  align: Align.optional(),
  get row() {
    return z.array(NodeSchema).min(1);
  },
});

const ColumnSchema: z.ZodType<ColumnInput> = z.strictObject({
  align: Align.optional(),
  get column() {
    return z.array(NodeSchema).min(1);
  },
});

// Keep the order in sync with NODE_KEYS, which tells which branch a node was meant to match
export const NodeSchema: z.ZodType<NodeInput> = z.union([
  LeafSchema,
  GroupSchema,
  RowSchema,
  ColumnSchema,
]);
export const NODE_KEYS = ['icon', 'group', 'row', 'column'] as const;

const Endpoint = z
  .string()
  .regex(
    new RegExp(`^[A-Za-z][A-Za-z0-9_-]*(\\.(${POSITIONS.join('|')}))?$`),
    `endpoint must be "<id>" or "<id>.<position>" (position: ${POSITIONS.join(', ')})`,
  );

const LinkSchema = z.union([
  z.tuple([Endpoint, Endpoint]),
  z.strictObject({
    from: Endpoint,
    to: Endpoint,
    label: z.string().optional(),
    style: z.enum(['solid', 'dashed']).optional(),
    arrow: z.enum(['end', 'start', 'both', 'none']).optional(),
  }),
]);

export const DocumentSchema = z.strictObject({
  title: z.string().optional(),
  direction: Direction.optional(),
  nodes: z.array(NodeSchema).min(1),
  links: z.array(LinkSchema).optional(),
});

export type DocumentInput = z.infer<typeof DocumentSchema>;
