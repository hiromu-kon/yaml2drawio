# Examples

**English** | [日本語](README.ja.md)

Each diagram below is generated from the YAML file next to it with `yaml2drawio build` and rendered with draw.io.
Click an image to see it full size, or open the `.drawio` file in draw.io to edit it.

## Quick start

A VPC with an internet gateway on its border, a load balancer, and a row with an API and its database.

<a href="../docs/images/quick-start.png"><img src="../docs/images/quick-start.png" alt="A VPC with an IGW, an ALB, an API and Aurora" width="240"></a>

[quick-start.yaml](quick-start.yaml) · [quick-start.drawio](../docs/images/quick-start.drawio)

## Web application

A region with two availability zones, each with public, app and data subnets, and lines that run straight down through them.

<a href="../docs/images/web-app.png"><img src="../docs/images/web-app.png" alt="A web application across two availability zones on AWS" width="360"></a>

[web-app.yaml](web-app.yaml) · [web-app.drawio](../docs/images/web-app.drawio)

## E-commerce platform

A primary region in Tokyo and a disaster recovery region in Osaka, with services outside the VPC, empty slots that line up rows of different lengths, and labels on lines.

<a href="../docs/images/ecommerce.png"><img src="../docs/images/ecommerce.png" alt="An e-commerce platform across two AWS regions"></a>

[ecommerce.yaml](ecommerce.yaml) · [ecommerce.drawio](../docs/images/ecommerce.drawio)

## Multi-cloud

Google Cloud, Azure and a GKE cluster in one diagram, each on its own draw.io layer so it can be shown or hidden on its own.

<a href="../docs/images/multi-cloud.png"><img src="../docs/images/multi-cloud.png" alt="Google Cloud, Azure and a GKE cluster" width="720"></a>

[multi-cloud.yaml](multi-cloud.yaml) · [multi-cloud.drawio](../docs/images/multi-cloud.drawio)

## Provider groups

The groups for Google Cloud, Azure and Kubernetes, such as projects, subscriptions, VNets, namespaces and nodes, nested the way each provider draws them.

<a href="../docs/images/provider-groups.png"><img src="../docs/images/provider-groups.png" alt="Groups for Google Cloud, Azure and Kubernetes"></a>

[provider-groups.yaml](provider-groups.yaml) · [provider-groups.drawio](../docs/images/provider-groups.drawio)
