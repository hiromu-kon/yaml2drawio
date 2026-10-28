---
name: yaml2drawio
description: Draws cloud architecture diagrams as laid-out draw.io files with the yaml2drawio CLI, from infrastructure code (Terraform, OpenTofu, CloudFormation, AWS CDK), a running cloud account, or a written description, including diagrams that span several clouds. Use when asked for an architecture, infrastructure, network or system diagram, a draw.io diagram of cloud resources, or to visualize Terraform or CDK code.
compatibility: Requires Node.js 24 or later to run npx yaml2drawio. Rendering a PNG also needs draw.io Desktop.
---

# Drawing architecture diagrams with yaml2drawio

yaml2drawio computes the layout; your job is to decide what goes in the diagram and how it nests. Never write coordinates.

## Workflow

Copy this checklist and work through it:

```
- [ ] Read the format: npx yaml2drawio guide
- [ ] Collect resources and connections from the source (see below)
- [ ] Decide what to draw (see below)
- [ ] Look up every icon and group name with npx yaml2drawio icons <word>
- [ ] Write diagram.yaml
- [ ] Run npx yaml2drawio build diagram.yaml --strict until it exits with 0 and prints no note: lines (see below)
- [ ] If draw.io Desktop is installed, add --png and look at the image
- [ ] Report what you left out and what you inferred (see below)
```

## Collect resources and connections

Read the reference for the source you have:

- **Terraform or OpenTofu**: [references/terraform.md](references/terraform.md)
- **CloudFormation or AWS CDK**: run `cdk synth` for CDK (it only writes templates), then read the `Resources` of the template the same way as Terraform resources: placement from subnet and VPC properties, connections from references between resources.
- **A running account**: use read-only commands only (`describe`, `list`, `get`), never anything that changes resources. Each provider reference below lists the commands to use.
- **A description**: draw what is described. Do not add resources the user did not mention, apart from the boundaries they imply (a VPC around subnets).

## Decide what to draw

- Draw what serves or stores something (load balancers, compute, databases, queues, buckets), the entry points (users, DNS, CDN), and the boundaries (account, region, network, zone, subnet).
- Leave out what only configures those: roles and policies, route tables, target groups, listeners, parameter groups, log groups. Fold what matters into a label or a line instead (a port, a protocol).
- Draw a line only when the source shows the connection: a firewall rule that admits traffic from another resource, an origin, an event source or subscription, a target attachment, an endpoint passed in configuration. Label it with the protocol or port when the source gives one.
- When a connection is likely but not shown (an API that surely talks to its database), you may draw it, and say so in the report.
- Firewall groups (security groups, network security groups) become lines, not boxes. Draw them as boxes only when the user asks, or when the diagram is about access control.
- A resource with no known place goes in the smallest boundary that surely holds it (inside the region, outside the VPC) and is reported.
- Prefer one clear diagram over a complete one. If there are more than about 40 icons, ask whether to split it (for example network and data flow) before drawing.
- When readers will want to look at flows or sites one at a time (requests, CI/CD, a DR site), put them on `layers` so they can be shown and hidden in draw.io. See "Layers" in the guide.

## Several clouds in one diagram

- Give each cloud, and each on-premises site, its own top-level group, and connect them with lines (VPN, interconnect, API calls). A line may end on a group's side (`office.e`) as well as on an icon.
- Icon names start with a namespace (`aws.ecs`). `npx yaml2drawio --help` lists the namespaces; the guide explains them.
- AWS, Google Cloud, Azure and Kubernetes have icons (`aws.*`, `gcp.*`, `azure.*`, `k8s.*`). Each has groups for its boundaries (`aws.vpc`, `gcp.project`, `azure.vnet`, `k8s.namespace`), nested as the provider reference says.
- For a provider without icons yet, use the `general.*` icons and name the service in the label: `general.database`, `general.server`, `general.servers`, `general.application`, `general.firewall`, `general.internet`, `general.users`, `general.client`. Put them in a `general.generic` group labeled with the provider's name.
- For a product with no icon (a SaaS such as Cloudflare or Datadog), use a `general.*` icon with its name in the label. Use `image:` with a logo only when the user gives you the file; do not download logos, since using one is the user's call.
- An on-premises site is a `general.data_center` group. Use `network.*` only for equipment `general.*` lacks, such as `network.switch` or `network.mainframe`.
- Provider conventions: [references/aws.md](references/aws.md), [references/gcp.md](references/gcp.md), [references/azure.md](references/azure.md), [references/kubernetes.md](references/kubernetes.md).

## Fix what build reports

- Errors stop the build and point at `file:line:column`, often with a suggestion. Fix the YAML there.
- Warnings name a link and the icon, label, other line or group border it crosses or runs along, or a corner it ends at. Follow "Getting a clean layout" in the guide: other sides, entering nested icons from the side or `clear_label: true` on their group, reordering children, moving an icon to a group's `border`.
- A `note:` means a link has an end without a side, so it is not checked. Give both ends a side. Never remove sides to get rid of a warning.

## Report

End with a short list of:

- resources you left out, and why
- connections you inferred rather than read
- placements you guessed
