# yaml2drawio

**English** | [日本語](README.ja.md)

[![CI](https://github.com/hiromu-kon/yaml2drawio/actions/workflows/ci.yml/badge.svg)](https://github.com/hiromu-kon/yaml2drawio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Infrastructure diagrams as code, output as editable draw.io files.**

yaml2drawio turns a YAML description of your infrastructure into a laid-out [draw.io](https://www.drawio.com/) diagram.
You describe the structure — what sits inside what, in which order, and what connects to what — and yaml2drawio computes every coordinate.

> [!NOTE]
> Work in progress. The icon catalog and the input schema exist; layout and draw.io output come next. See the [roadmap](#roadmap).

yaml2drawio only draws diagrams. It does not read or change your cloud resources.

## Why

- **Diagrams drawn by hand or by AI drift.** Positions change every time you regenerate, icons are wrong, and lines run over labels.
- **Diagram-as-code tools usually render images.** You get a PNG or SVG, so you cannot fine-tune the result in draw.io or keep editing it with your team.

yaml2drawio keeps the diagram in version control as readable text and still gives you a native `.drawio` file.

## Features

- **Structure, not coordinates** (planned)
  Nesting, order and direction decide the layout, so the same YAML always produces the same diagram.
- **Official draw.io shapes**
  Icons come from a catalog extracted from draw.io's own shape library (930 AWS icons and 20 groups). An unknown name is an error with suggestions, never a guess.
- **Editable output** (planned)
  The result is a native `.drawio` file you can open in draw.io or the VS Code extension.
- **Made for AI agents too** (planned)
  Compact YAML and strict validation let an agent write a diagram, check it, and fix it without guessing.
- **Beyond AWS**
  Icon names are namespaced (`aws.ecs`, `aws.vpc`) so other providers can be added side by side.

## Example

> The output image will be added once the draw.io writer is ready.

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

## Comparison

|             | yaml2drawio                     | [awsdac](https://github.com/awslabs/diagram-as-code) | [Diagrams](https://github.com/mingrammer/diagrams) | [D2](https://github.com/terrastruct/d2) |
| ----------- | ------------------------------- | ---------------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Input       | YAML                            | YAML                                                 | Python                                             | D2 language                             |
| Output      | `.drawio` (editable)            | PNG                                                  | PNG, JPG, SVG, PDF, DOT                            | SVG, PNG, GIF, PDF, PPTX                |
| Layout      | Computed from nesting and order | Computed from nesting and order                      | Graphviz                                           | Dagre, ELK or TALA                      |
| Cloud icons | AWS (more planned)              | AWS (extensible with definition files)               | AWS, Azure, GCP, Kubernetes and more               | Any image                               |

## Roadmap

- [x] AWS icon catalog extracted from draw.io
- [x] Input schema
- [ ] Validation errors with line numbers and suggestions
- [ ] Layout engine
- [ ] draw.io writer
- [ ] PNG preview through draw.io Desktop
- [ ] npm package
- [ ] GCP, Azure and Kubernetes icons

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

Icons are extracted from draw.io's sidebar definitions ([jgraph/drawio](https://github.com/jgraph/drawio), Apache-2.0).
yaml2drawio is not affiliated with draw.io or JGraph.
