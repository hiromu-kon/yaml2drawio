<img src="docs/images/logo.svg" alt="yaml2drawio logo" width="96">

# yaml2drawio

**English** | [日本語](README.ja.md)

[![CI](https://github.com/hiromu-kon/yaml2drawio/actions/workflows/ci.yml/badge.svg)](https://github.com/hiromu-kon/yaml2drawio/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/yaml2drawio)](https://www.npmjs.com/package/yaml2drawio)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Infrastructure diagrams as code, output as editable draw.io files.**

yaml2drawio turns a YAML description of your infrastructure into a laid-out [draw.io](https://www.drawio.com/) diagram.
You describe the structure — what sits inside what, in which order, and what connects to what — and yaml2drawio computes every coordinate.

![An e-commerce platform drawn by yaml2drawio](docs/images/ecommerce.png)

<sub>Generated from [examples/ecommerce.yaml](examples/ecommerce.yaml) and rendered with draw.io.</sub>

> [!NOTE]
> Early release (0.x). The YAML format may still change between minor versions.

yaml2drawio only draws diagrams. It does not read or change your cloud resources.

## Why

- **Diagrams drawn by hand or by AI drift.** Positions change every time you regenerate, icons are wrong, and lines run over labels.
- **Diagram-as-code tools usually render images.** You get a PNG or SVG, so you cannot fine-tune the result in draw.io or keep editing it with your team.

yaml2drawio keeps the diagram in version control as readable text and still gives you a native `.drawio` file.

## Features

- **Structure, not coordinates**
  Nesting, order and direction decide the layout, so the same YAML always produces the same diagram.
- **Official draw.io shapes**
  Icons come from a catalog extracted from draw.io's own shape library (930 AWS icons and 20 groups). An unknown name is an error with suggestions, never a guess.
- **Editable output**
  The result is a native `.drawio` file you can open in draw.io or the VS Code extension.
- **Made for AI agents too**
  Compact YAML and strict validation let an agent write a diagram, check it, and fix it without guessing.
- **Beyond AWS**
  Icon names are namespaced (`aws.ecs`, `aws.vpc`) so other providers can be added side by side.

## Getting started

Requires Node.js 24 or later. PNG output also needs [draw.io Desktop](https://www.drawio.com/).

```sh
npx yaml2drawio build diagram.yaml          # writes diagram.drawio
npx yaml2drawio build diagram.yaml --png    # also renders diagram.png with draw.io Desktop
npx yaml2drawio build diagram.yaml -o docs/architecture.drawio
npx yaml2drawio icons redis                 # search icon names
```

Errors point at the line and column to fix, for example `diagram.yaml:4:15: unknown key "icn" (did you mean "icon"?)`.
If draw.io Desktop is not found, set `DRAWIO_CLI` to its executable.

## Example

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

![The diagram generated from the YAML above](docs/images/quick-start.png)

More examples are in [examples/](examples/).

### Editor support

Point your YAML file at the JSON Schema to get completion for keys, icon names and group names, and to see mistakes before you build. In VS Code this needs the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml).

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/hiromu-kon/yaml2drawio/main/schema.json
```

## Comparison

|             | yaml2drawio                     | [awsdac](https://github.com/awslabs/diagram-as-code) | [Diagrams](https://github.com/mingrammer/diagrams) | [D2](https://github.com/terrastruct/d2) |
| ----------- | ------------------------------- | ---------------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Input       | YAML                            | YAML                                                 | Python                                             | D2 language                             |
| Output      | `.drawio` (editable)            | PNG                                                  | PNG, JPG, SVG, PDF, DOT                            | SVG, PNG, GIF, PDF, PPTX                |
| Layout      | Computed from nesting and order | Computed from nesting and order                      | Graphviz                                           | Dagre, ELK or TALA                      |
| Cloud icons | AWS (more planned)              | AWS (extensible with definition files)               | AWS, Azure, GCP, Kubernetes and more               | Any image                               |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

Icons are extracted from draw.io's sidebar definitions ([jgraph/drawio](https://github.com/jgraph/drawio), Apache-2.0).
yaml2drawio is not affiliated with draw.io or JGraph.
