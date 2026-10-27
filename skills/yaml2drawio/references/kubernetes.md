# Kubernetes conventions

Kubernetes has no group styles yet. Draw each boundary as a `general.generic` group whose label says what it is, such as `Namespace: payments`.

## Boundaries

`Cluster: <name>` > `Namespace: <name>`

- A managed cluster (EKS, GKE, AKS) sits inside its cloud's network boundary (a private subnet, a region), so the cluster group goes there.
- Draw nodes only when the diagram is about scheduling or capacity; otherwise workloads go straight into their namespace.
- Cluster-wide objects (ingress controllers, cluster roles, storage classes) go in the cluster, outside the namespaces, or in the namespace they run in (an ingress controller in `ingress-nginx`).

## What to draw

- Draw the path a request takes: `k8s.ingress` > `k8s.service` > `k8s.deployment` (or `k8s.statefulset`), and from the workload to what it uses (`k8s.persistent_volume_claim`, a database outside the cluster).
- Leave out pods unless their number or placement matters; a Deployment stands for its pods. Leave out ReplicaSets.
- ConfigMaps, Secrets, service accounts and roles only configure workloads; mention them in a label instead of drawing them, unless the diagram is about configuration or access.
- Each icon has a `_labeled` version with its abbreviation written in it (`k8s.service_labeled`). Use one style throughout a diagram.

## Reading manifests or a running cluster

- Manifests and Helm charts: read `kind`, `metadata.namespace`, the selectors that tie a Service to a Deployment, and the backends of an Ingress. For Helm, `helm template` renders the manifests without touching a cluster.
- A running cluster: read-only commands only, and ask which context to use.

```sh
kubectl get namespaces
kubectl get ingress,service,deployment,statefulset,cronjob --all-namespaces
kubectl get persistentvolumeclaims --all-namespaces
```
