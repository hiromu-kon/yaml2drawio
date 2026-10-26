import { describe, expect, it } from 'vitest';
import { load, problemsOf } from './helpers.ts';

describe('loadDiagram', () => {
  it('uses the shape title as the label when none is given', () => {
    const diagram = load('nodes:\n  - { id: fn, icon: aws.lambda }\n');
    expect(diagram.root.children[0]).toMatchObject({ kind: 'leaf', label: 'Lambda' });
  });

  it('defaults every direction to horizontal', () => {
    const diagram = load(
      'nodes:\n  - group: aws.vpc\n    children:\n      - { id: fn, icon: aws.lambda }\n',
    );
    expect(diagram.root.direction).toBe('horizontal');
    expect(diagram.root.children[0]).toMatchObject({ kind: 'group', direction: 'horizontal' });
  });

  it('reports schema errors with their line and column', () => {
    const problems = problemsOf('nodes:\n  - { id: fn, icn: aws.lambda }\n');
    expect(problems[0]).toMatch(/^2:5 nodes\.0: /);
  });

  it('reports an unknown icon with close names', () => {
    expect(problemsOf('nodes:\n  - { id: fn, icon: aws.lamda }\n')).toEqual([
      expect.stringMatching(/^unknown icon "aws\.lamda" \(did you mean aws\.lambda/),
    ]);
  });

  it('reports a link to an unknown id', () => {
    const problems = problemsOf(
      'nodes:\n  - { id: fn, icon: aws.lambda }\nlinks:\n  - [fn.e, db.w]\n',
    );
    expect(problems).toEqual(['link endpoint "db.w" refers to unknown id "db"']);
  });

  it('reports duplicate ids', () => {
    const problems = problemsOf(
      'nodes:\n  - { id: fn, icon: aws.lambda }\n  - { id: fn, icon: aws.sqs }\n',
    );
    expect(problems).toEqual(['duplicate id "fn"']);
  });

  it('rejects border children until they are supported', () => {
    const problems = problemsOf(
      [
        'nodes:',
        '  - group: aws.vpc',
        '    id: vpc',
        '    border:',
        '      n: { id: igw, icon: aws.igw }',
        '    children:',
        '      - { id: fn, icon: aws.lambda }',
        '',
      ].join('\n'),
    );
    expect(problems).toEqual(['group "vpc": border is not supported yet']);
  });

  it('turns both link forms into the same structure', () => {
    const diagram = load(
      [
        'nodes:',
        '  - { id: a, icon: aws.lambda }',
        '  - { id: b, icon: aws.sqs }',
        'links:',
        '  - [a.e, b]',
        '  - { from: b, to: a.e, style: dashed, label: poll, arrow: both }',
        '',
      ].join('\n'),
    );
    expect(diagram.links).toEqual([
      {
        id: 'link-1',
        from: { id: 'a', position: 'e' },
        to: { id: 'b', position: undefined },
        label: '',
        dashed: false,
        arrow: 'end',
      },
      {
        id: 'link-2',
        from: { id: 'b', position: undefined },
        to: { id: 'a', position: 'e' },
        label: 'poll',
        dashed: true,
        arrow: 'both',
      },
    ]);
  });
});
