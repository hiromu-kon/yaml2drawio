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
      '2:5: a node needs one of "icon", "group", "row", "column"',
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
