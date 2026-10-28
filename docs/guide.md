# Writing a yaml2drawio diagram

yaml2drawio turns a YAML file into a laid-out draw.io diagram. You describe what goes inside what and which lines connect what; positions are computed, so never write coordinates.

## Workflow

```sh
npx yaml2drawio icons <word>                  # find icon and group names
npx yaml2drawio build diagram.yaml --strict   # writes diagram.drawio, exits with 1 on errors or warnings
npx yaml2drawio build diagram.yaml --png      # also renders diagram.png (needs draw.io Desktop)
```

1. Look up every icon and group name with `icons`. Do not guess names.
2. Write the YAML.
3. Run `build --strict` and fix what it reports, until it exits with 0.
   - Errors (unknown key, unknown icon, unknown id) stop the build and point at `file:line:column`, often with a suggestion.
   - Warnings say which link crosses which icon or label, or runs along which line or group border. The file, and the PNG with `--png`, is still written.

## Example

```yaml
title: Web service
direction: vertical
nodes:
  - { id: users, icon: aws.users, label: Users }
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
  - [users.s, igw.n]
  - [igw.s, alb.n]
  - [alb.s, api.n]
  - { from: api.e, to: db.w, label: SQL, style: dashed }
```

## Document

| Key         | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `title`     | Name of the draw.io page                                          |
| `direction` | `horizontal` (default) or `vertical`: how top-level nodes line up |
| `nodes`     | List of nodes (required)                                          |
| `links`     | List of links                                                     |
| `layers`    | draw.io layers, bottom first (see [Layers](#layers))              |

## Icon names

Names start with a namespace. `npx yaml2drawio --help` lists them.

- `aws.*`: AWS services, resources and groups
- `gcp.*`: Google Cloud products, such as `gcp.cloud_run`, `gcp.gke`, `gcp.cloud_sql`, `gcp.pubsub`
- `azure.*`: Azure services, such as `azure.app_service`, `azure.aks`, `azure.cosmos_db`, `azure.key_vault`
- `k8s.*`: Kubernetes objects, such as `k8s.deployment`, `k8s.service`, `k8s.ingress`; add `_labeled` for the version with its abbreviation written in it (`k8s.service_labeled`)
- `general.*`: provider-neutral icons in the same flat style, such as `general.users`, `general.internet`, `general.server`, `general.database`, `general.firewall`, and the group `general.data_center`
- `network.*`: on-premises equipment the others lack, such as `network.switch`, `network.mainframe` and `network.laptop`, in draw.io's older gray network style

Prefer the provider's own icon, then `general.*`, and use `network.*` only for what neither has, so the diagram keeps one look. For a product none of them has, such as a SaaS, use `general.*` with its name in the label, or an `image` of its logo when you have the file.

Groups for boundaries:

- Google Cloud: `gcp.project`, `gcp.vpc`, `gcp.region`, `gcp.subnet`, `gcp.zone`
- Azure: `azure.subscription`, `azure.resource_group`, `azure.region`, `azure.vnet`, `azure.subnet`, `azure.az`
- Kubernetes: `k8s.cluster`, `k8s.namespace` (or `k8s.ns`), `k8s.node`, `k8s.control_plane`

For a boundary without its own group, such as a Google Cloud folder or another provider, use `general.generic` and say what it is in the label, such as `Folder: production`.

## Nodes

A node is one of five kinds, told apart by its key.

**Icon** `{ id, icon, label, layer }`

- `id`: unique, starts with a letter; letters, digits, `_` and `-`. Links refer to it.
- `icon`: a name from `icons`, such as `aws.ecs`.
- `label`: text under the icon; defaults to the icon's title. Use `\n` in a quoted string for a line break.

**Image** `{ id, image, label, layer }`: an icon drawn from your own file, for a service no catalog has, such as `{ id: cdn, image: logos/cloudflare.svg, label: Cloudflare }`.

- `image`: an `.svg` or `.png` file, relative to the YAML file. It is embedded in the `.drawio` file, which stays one file that opens anywhere.
- It fits the same square as an icon, keeping its proportions, and works anywhere an icon does, including `border`.
- `label` defaults to the file name. A node takes `icon` or `image`, not both.

**Group** `{ group, label, children, direction, align, border, clear_label, layer, id }`

- `group`: a group style such as `aws.cloud`, `aws.region`, `aws.vpc`, `aws.az`, `aws.public_subnet`, `aws.private_subnet`, `aws.security_group`, `aws.generic`, `gcp.project`, `azure.vnet`, `k8s.namespace`.
- `children`: nodes inside the box. Leave it out for an empty box, such as a subnet with nothing drawn in it.
- `direction`: `horizontal` (default) puts the children side by side; `vertical` stacks them.
- `align`: `start`, `center` (default), `end`, or `expand` to give all children the same size across the direction. Use `expand` on the AZs in a row so their subnets line up.
- `border`: icons on the edge of the box, keyed by position (see below). Typical: an internet gateway at `n`, VPC endpoints at `e`. Only for what sits on the boundary itself, such as gateways and endpoints: an icon on the border reads as part of the group.
- `clear_label`: `true` widens the box on both sides until its first icon starts right of the label at the top left, so a line can come down into that icon, or go up out of it. Only for groups whose label sits at the top left.
- `id`: needed only to link to the group itself.

**Row** `{ row, align, layer }`: `row` is a list of nodes laid out left to right without a box.

**Column** `{ column, align, layer }`: `column` is a list of nodes laid out top to bottom without a box.

## Positions

Positions name points on the edge of a box, like a compass. They are used for border icons and for the side a line leaves or enters.

```
nw   nnw   n   nne   ne
wnw                  ene
w                    e
wsw                  ese
sw   ssw   s   sse   se
```

## Links

```yaml
links:
  - [alb.s, api.n] # from alb's bottom to api's top
  - [api, db] # no sides: draw.io picks them
  - { from: api.e, to: queue.w, label: jobs, style: dashed, arrow: both, route: drawio }
```

- A link is `[from, to]`, or an object with `from` and `to` when it needs more keys.
- An endpoint is `<id>` or `<id>.<position>`.
- `style`: `solid` (default) or `dashed`. `arrow`: `end` (default), `start`, `both` or `none`.
- `route`: `auto` (default) bends the line in the gaps around groups; `drawio` leaves the whole route to draw.io.
- `layer`: the layer to draw the line on (see below).

## Layers

Layers let readers show and hide parts of the diagram in draw.io, such as one flow of lines or one site. With every layer shown, the diagram looks the same as without layers.

```yaml
layers: [On-premises, CI/CD]
nodes:
  - { id: developers, icon: general.users, label: Developers }
  - group: aws.cloud
    children:
      - { id: pipeline, icon: aws.codepipeline, label: CodePipeline }
      - { id: api, icon: aws.ecs, label: API }
  - group: general.data_center
    layer: On-premises
    children:
      - { id: db, icon: general.database, label: Database }
links:
  - { from: developers.e, to: pipeline.w, layer: CI/CD }
  - [pipeline.e, api.w]
  - [api.e, db.w] # on On-premises, the upper layer of its ends
```

- `layers` names the layers, bottom first. Everything without a layer is on draw.io's Background layer, below them.
- `layer` on an icon, group, row or column puts it and everything in it on that layer. It works only outside groups: in draw.io, the children of a group are always on the group's layer.
- A line without `layer` is on the upper layer of its two ends. A line's `layer` cannot be below the layer of either end, or that layer's boxes would cover it.
- draw.io also hides a line when either of its ends is hidden.
- Layers change only what is shown. The layout and the warnings are the same with any layer hidden.

## Getting a clean layout

### Structure

- Nest groups the way the system is built: cloud, region, VPC, AZ, subnet.
- Use `direction: vertical` for a request flow from top to bottom, and put the entry point (users, DNS, CDN) first.
- A resource that spans AZs, such as an ALB, goes inside the VPC above the row of AZs, not inside one subnet.
- A service that runs in several subnets, such as an ECS service or an Aurora cluster, gets one icon per subnet (`api_a`, `api_c`).
- Put the AZs in a row with `align: expand`, and give each AZ `direction: vertical` and `align: expand`, so the AZs and their subnets line up.
- Draw unused subnets as empty groups rather than leaving them out.
- Put services that sit in a region but outside the VPC (S3, SQS, Lambda) in a `column` beside the VPC, inside the region, on the side their lines come from. Above or below the VPC, they sit in the way of the lines into it.
- Stack several icons in one subnet with `direction: vertical` when lines go between subnets: side by side, a line out of one icon's side runs over its neighbor.

### Lines

- Give both ends of every link a side that faces the other end: `a.s -> b.n` when b is below, `a.e -> b.w` when b is to the right.
- Only links with a side at both ends are checked for crossings (with either `route`). Links without sides are reported as `note:` lines; never drop sides just to get rid of a warning.
- Labels of AWS groups with an icon (region, VPC, subnets) and of the Google Cloud, Azure and Kubernetes groups sit at the top left; labels of AWS AZs and generic groups are centered at the top. A line coming down into the top of an icon right below such a label crosses it.
- In a vertical group with a centered label, the first child sits right under the label. Start the group with something no line enters from above, bring the line in from the side, or lay the group out horizontally so the target is not in the middle.
- So enter an icon inside nested groups from the side: `alb.w -> api_a.w`, `alb.e -> api_c.e`. The line then runs down in the gap beside the group.
- When a line should come straight down instead, such as from an icon right above (`api.s -> db.n` with the database alone in its subnet), give the groups under it `clear_label: true`. Give it to the groups stacked with it as well, so they keep the same width.
- With several icons in one subnet, give each of their lines its own side, using the points between the corners (`ene`, `ese`, `wsw`) when the four sides run out.
- Do not end a line at a corner (`ne`, `se`, `sw`, `nw`): draw.io may start it along either edge. Use the point beside it, such as `sse` or `ese`. Corners are fine for border icons.
- A line's label goes halfway along it, or as near as it can without covering an icon or a label, and off group borders when there is room.
- Use a different side to leave an icon than the side you entered it from (`alb.w -> api_a.w`, then `api_a.e -> db_a.e`), or the two lines overlap and read as one. The side you leave from must face open space: with a neighbor on that side, the line crosses it.
- Lines that run along each other read as one, and a dashed line along a solid one looks solid. Lines may share a start point and split later, like branches, when they are drawn alike. Give lines from different icons their own end points (`deploy.e -> app.wnw`, `registry.e -> app.w`), and give a dashed line its own start point (`cdn.s -> igw.n`, `cdn.sse -> igw_dr.n`).
- When a link still crosses something, try other sides, reorder the children, move the icon to a group's `border`, or set `route: drawio`.

### Example: a VPC across two AZs

```yaml
title: Multi-AZ web service
direction: vertical
nodes:
  - { id: users, icon: aws.users, label: Users }
  - group: aws.region
    label: ap-northeast-1
    direction: vertical
    children:
      - group: aws.vpc
        label: VPC 10.0.0.0/16
        direction: vertical
        border:
          n: { id: igw, icon: aws.igw, label: IGW }
        children:
          - { id: alb, icon: aws.alb, label: ALB }
          - align: expand
            row:
              - group: aws.az
                label: ap-northeast-1a
                direction: vertical
                align: expand
                children:
                  - group: aws.public_subnet
                    label: Public 10.0.0.0/24
                    children:
                      - { id: nat, icon: aws.nat_gateway, label: NAT gateway }
                  - group: aws.private_subnet
                    label: App 10.0.10.0/24
                    children:
                      - { id: api_a, icon: aws.ecs, label: API }
                  - group: aws.private_subnet
                    label: Data 10.0.20.0/24
                    children:
                      - { id: db_a, icon: aws.aurora, label: Aurora writer }
              - group: aws.az
                label: ap-northeast-1c
                direction: vertical
                align: expand
                children:
                  - group: aws.public_subnet
                    label: Public 10.0.1.0/24
                  - group: aws.private_subnet
                    label: App 10.0.11.0/24
                    children:
                      - { id: api_c, icon: aws.ecs, label: API }
                  - group: aws.private_subnet
                    label: Data 10.0.21.0/24
                    children:
                      - { id: db_c, icon: aws.aurora, label: Aurora reader }
links:
  - [users.s, igw.n]
  - [igw.s, alb.n]
  - [alb.w, api_a.w]
  - [alb.e, api_c.e]
  - [api_a.e, db_a.e]
  - [api_c.w, db_c.w]
```

## Editor support

Add this first line to get completion and checks in editors that support JSON Schema:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/hiromu-kon/yaml2drawio/main/schema.json
```
