import { describe, expect, it } from 'vitest';
import { load, problemsOf } from './helpers.ts';

const lines = (...rows: string[]) => `${rows.join('\n')}\n`;

describe('loadDiagram', () => {
  it('uses the shape title as the label when none is given', () => {
    const diagram = load(lines('nodes:', '  - { id: fn, icon: aws.lambda }'));
    expect(diagram.root.children[0]).toMatchObject({ kind: 'leaf', label: 'Lambda' });
  });

  it('defaults every direction to horizontal', () => {
    const diagram = load(
      lines(
        'nodes:',
        '  - group: aws.vpc',
        '    children:',
        '      - { id: fn, icon: aws.lambda }',
      ),
    );
    expect(diagram.root.direction).toBe('horizontal');
    expect(diagram.root.children[0]).toMatchObject({ kind: 'group', direction: 'horizontal' });
  });

  it('accepts a group without children, such as an unused subnet', () => {
    const diagram = load(lines('nodes:', '  - { group: aws.public_subnet, label: Public }'));
    expect(diagram.root.children[0]).toMatchObject({ kind: 'group', children: [] });
  });

  it('reads a label that YAML parses as a number as text', () => {
    const diagram = load(
      lines(
        'nodes:',
        '  - { id: a, icon: aws.lambda, label: 2 }',
        '  - { id: b, icon: aws.sqs }',
        'links:',
        '  - { from: a.e, to: b.w, label: 8080 }',
      ),
    );
    expect(diagram.root.children[0]).toMatchObject({ label: '2' });
    expect(diagram.links[0]).toMatchObject({ label: '8080' });
  });

  it('turns both link forms into the same structure', () => {
    const diagram = load(
      lines(
        'nodes:',
        '  - { id: a, icon: aws.lambda }',
        '  - { id: b, icon: aws.sqs }',
        'links:',
        '  - [a.e, b]',
        '  - { from: b, to: a.e, style: dashed, label: poll, arrow: both }',
      ),
    );
    expect(diagram.links).toEqual([
      {
        id: 'link-1',
        from: { id: 'a', position: 'e' },
        to: { id: 'b', position: undefined },
        label: '',
        dashed: false,
        arrow: 'end',
        route: 'auto',
        location: { line: 5, column: 5 },
      },
      {
        id: 'link-2',
        from: { id: 'b', position: undefined },
        to: { id: 'a', position: 'e' },
        label: 'poll',
        dashed: true,
        arrow: 'both',
        route: 'auto',
        location: { line: 6, column: 5 },
      },
    ]);
  });

  const LAYERED = [
    'layers: [Cloud, Flows]',
    'nodes:',
    '  - { id: users, icon: general.users }',
    '  - row:',
    '      - group: general.generic',
    '        layer: Cloud',
    '        children: [{ id: app, icon: general.server }]',
    '      - { id: db, icon: general.database }',
    '    layer: Flows',
  ];

  it('puts a line on the upper layer of its ends unless it names a layer above them', () => {
    const diagram = load(
      lines(
        ...LAYERED,
        'links:',
        '  - [users.e, app.w]',
        '  - [app.e, db.w]',
        '  - { from: users.s, to: app.s, layer: Flows }',
      ),
    );
    expect(diagram.links.map((link) => link.layer)).toEqual(['Cloud', 'Flows', 'Flows']);
  });

  it('gives the children of a row its layer, and those inside a group none of their own', () => {
    const [users, row] = load(lines(...LAYERED)).root.children;
    expect(users).toMatchObject({ layer: undefined });
    expect(row?.kind === 'stack' && row.children).toMatchObject([
      { kind: 'group', layer: 'Cloud', children: [{ id: 'app', layer: undefined }] },
      { id: 'db', layer: 'Flows' },
    ]);
  });
});

describe('loadDiagram errors', () => {
  it('reports YAML syntax errors with their location', () => {
    expect(problemsOf(lines('nodes:', '  - { id: a, icon: aws.lambda'))[0]).toMatch(/^3:1: /);
  });

  it('suggests the intended key for a misspelled one', () => {
    expect(problemsOf(lines('nodes:', '  - { id: fn, icon: aws.lambda, labl: Fn }'))).toEqual([
      '2:33: unknown key "labl" (did you mean "label"?)',
    ]);
  });

  it('says which keys make a node when it has none of them', () => {
    expect(problemsOf(lines('nodes:', '  - { id: fn, icn: aws.lambda }'))).toEqual([
      '2:5: a node needs one of "icon", "image", "group", "row", "column"',
      '2:15: unknown key "icn" (did you mean "icon"?)',
    ]);
  });

  it('reports only the errors of the kind of node that was meant', () => {
    expect(problemsOf(lines('nodes:', '  - { icon: aws.lambda }'))).toEqual([
      '2:5: missing required key "id"',
    ]);
  });

  it('reports an empty row', () => {
    expect(problemsOf(lines('nodes:', '  - { row: [] }'))).toEqual([
      '2:12: "row" must not be empty',
    ]);
  });

  it('reports a malformed link endpoint at the endpoint', () => {
    const problems = problemsOf(
      lines('nodes:', '  - { id: a, icon: aws.lambda }', 'links:', '  - [a.up, a]'),
    );
    expect(problems).toEqual([expect.stringMatching(/^4:6: item 1: endpoint must be/)]);
  });

  it('reports an unknown icon with close names', () => {
    expect(problemsOf(lines('nodes:', '  - { id: fn, icon: aws.lamda }'))).toEqual([
      expect.stringMatching(/^2:21: unknown icon "aws\.lamda" \(did you mean aws\.lambda,/),
    ]);
  });

  it('reports clear_label on a group that centers its label, which no padding can clear', () => {
    expect(
      problemsOf(
        lines(
          'nodes:',
          '  - group: aws.az',
          '    clear_label: true',
          '    children: [{ id: fn, icon: aws.lambda }]',
        ),
      ),
    ).toEqual(['3:18: clear_label needs a label at the top left, but "aws.az" centers its label']);
  });

  it.each([
    ['Monitorng', '"Monitoring", "Network"', 'did you mean "Monitoring"?'],
    ['Ops', '"Monitoring", "Network"', 'declared layers: Monitoring, Network'],
  ])('reports the unknown layer %s with the layers it may mean', (name, declared, advice) => {
    const source = lines(
      `layers: [${declared}]`,
      'nodes:',
      `  - { id: fn, icon: aws.lambda, layer: ${name} }`,
    );
    expect(problemsOf(source)).toEqual([`3:40: unknown layer "${name}" (${advice})`]);
  });

  it('reports a layer inside a group, whose children are drawn on its layer', () => {
    expect(
      problemsOf(
        lines(
          'layers: [A]',
          'nodes:',
          '  - group: aws.vpc',
          '    children: [{ id: fn, icon: aws.lambda, layer: A }]',
        ),
      ),
    ).toEqual(['4:51: layer works only outside groups; the children of a group share its layer']);
  });

  it('reports a line on a layer below one of its ends, which would hide it', () => {
    expect(
      problemsOf(
        lines(
          'layers: [Flows, Cloud]',
          'nodes:',
          '  - { id: a, icon: aws.lambda }',
          '  - { id: b, icon: aws.sqs, layer: Cloud }',
          'links:',
          '  - { from: a.e, to: b.w, layer: Flows }',
        ),
      ),
    ).toEqual([
      '6:34: link "a.e -> b.w" is on layer "Flows", below layer "Cloud" of "b", whose boxes would cover it',
    ]);
  });

  it('reports a layer declared twice', () => {
    expect(
      problemsOf(lines('layers: [A, A]', 'nodes:', '  - { id: fn, icon: aws.lambda }')),
    ).toEqual(['1:13: duplicate layer "A"']);
  });

  it('reports a node with both an icon and an image', () => {
    expect(
      problemsOf(lines('nodes:', '  - { id: cdn, icon: aws.cloudfront, image: cdn.svg }')),
    ).toEqual(['2:5: a node takes either "icon" or "image", not both']);
  });

  it('reports an image that cannot be read at its path', () => {
    expect(problemsOf(lines('nodes:', '  - { id: cdn, image: logos/cloudflare.svg }'))).toEqual([
      '2:23: image "logos/cloudflare.svg" not found (paths are relative to the YAML file)',
    ]);
  });

  it('reports a link to an unknown id', () => {
    const problems = problemsOf(
      lines('nodes:', '  - { id: fn, icon: aws.lambda }', 'links:', '  - [fn.e, db.w]'),
    );
    expect(problems).toEqual(['4:12: unknown id "db" in link "db.w"']);
  });

  it('reports duplicate ids with where the first one is', () => {
    const problems = problemsOf(
      lines('nodes:', '  - { id: fn, icon: aws.lambda }', '  - { id: fn, icon: aws.sqs }'),
    );
    expect(problems).toEqual(['3:11: duplicate id "fn" (first defined at 2:11)']);
  });

  it('resolves border children like any other icon', () => {
    const problems = problemsOf(
      lines(
        'nodes:',
        '  - group: aws.vpc',
        '    border:',
        '      n: { id: igw, icon: aws.igww }',
        '    children:',
        '      - { id: igw, icon: aws.lambda }',
      ),
    );
    expect(problems).toEqual([
      expect.stringMatching(/^4:27: unknown icon "aws\.igww"/),
      '6:15: duplicate id "igw" (first defined at 4:16)',
    ]);
  });

  it('lists problems in the order they appear in the file', () => {
    const problems = problemsOf(
      lines('nodes:', '  - group: aws.vpcc', '    children:', '      - { id: a, icon: aws.lamda }'),
    );
    expect(problems.map((problem) => problem.split(':', 1)[0])).toEqual(['2', '4']);
  });
});
