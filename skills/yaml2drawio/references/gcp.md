# Google Cloud conventions

Google Cloud has no group styles yet. Draw each boundary as a `general.generic` group whose label says what it is, such as `Project: shop-prod`.

## Boundaries

Nest them in this order, leaving out levels that add nothing:

Organization or folder (only when several projects appear) > `Project: <id>` > `VPC: <name>` > `Region: <name>` > `Subnet: <name> <range>`

- A VPC network is global and its subnets are regional, so regions go inside the VPC, not the other way round. Without a VPC in the diagram, put regions directly in the project.
- Serverless services (Cloud Run, Cloud Functions, App Engine) run outside your VPC: put them in the region, outside the VPC box. A Serverless VPC Access connector or Direct VPC egress is a line into the VPC, labeled as such.
- Global or multi-region services (Cloud Load Balancing, Cloud Armor, Cloud CDN, Cloud DNS, Pub/Sub, BigQuery, Cloud Storage) go in the project, outside every region.
- Cloud SQL and Memorystore with private IP live in a Google-managed network peered to yours: put them in the region, outside your subnets, and draw the line from the client.
- A GKE cluster is regional or zonal: put it in its region (and subnet when one is shown), with its workloads inside, as in [kubernetes.md](kubernetes.md).

## Icons

- Common names: `gcp.cloud_run`, `gcp.cloud_functions`, `gcp.gke`, `gcp.compute_engine`, `gcp.cloud_sql`, `gcp.memorystore`, `gcp.pubsub`, `gcp.bigquery`, `gcp.gcs`, `gcp.lb`, `gcp.cloud_armor`, `gcp.cloud_nat`, `gcp.vpc`, `gcp.cloud_vpn`, `gcp.cloud_interconnect`.
- Cloud Armor is a policy on the load balancer: draw it next to the load balancer or as a step on the request path, not as a box around anything.

## Reading a running project

Read-only commands only. Ask the user which project to use.

```sh
gcloud compute networks list --project <project>
gcloud compute networks subnets list --project <project>
gcloud run services list --project <project>
gcloud container clusters list --project <project>
gcloud sql instances list --project <project>
gcloud redis instances list --region <region> --project <project>
gcloud pubsub topics list --project <project>
gcloud compute forwarding-rules list --project <project>
```
