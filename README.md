# yaml2drawio

**English** | [日本語](README.ja.md)

Describe infrastructure diagrams (AWS first) in YAML and get a laid-out [draw.io](https://www.drawio.com/) file.
You write the structure — what is nested in what, in which order, and what connects to what — and yaml2drawio computes the coordinates.

> Status: work in progress. Only the icon catalog and the input schema exist so far.

## Example (planned)

```yaml
direction: vertical
nodes:
  - group: aws.vpc
    label: Production VPC
    direction: vertical
    border:
      n: { id: igw, icon: aws.igw, label: IGW }
    children:
      - { id: alb, icon: aws.alb, label: ALB }
      - row:
          - { id: api, icon: aws.ecs, label: API }
          - { id: db, icon: aws.aurora, label: Aurora }
links:
  - [igw.s, alb.n]
  - [alb.s, api.n]
  - { from: api.e, to: db.w, style: dashed }
```

## Development

Requires [mise](https://mise.jdx.dev/) (Node and pnpm versions are pinned in `mise.toml`).

```sh
pnpm install
pnpm check              # typecheck, lint, test, format check
pnpm dev icons redis    # search the icon catalog
pnpm catalog            # regenerate catalog/aws.json from draw.io sources
```

Icons are extracted from draw.io's sidebar definitions ([jgraph/drawio](https://github.com/jgraph/drawio), Apache-2.0).
yaml2drawio is not affiliated with draw.io or JGraph.

## License

MIT
