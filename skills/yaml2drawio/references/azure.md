# Azure conventions

Azure has no group styles yet. Draw each boundary as a `general.generic` group whose label says what it is, such as `VNet: hub 10.0.0.0/16`.

## Boundaries

Nest them in this order, leaving out levels that add nothing:

`Subscription: <name>` > `Region: <name>` > `VNet: <name> <range>` > `Subnet: <name> <range>`

- Resource groups are a management boundary, not a network one. Leave them out unless the diagram is about ownership; when needed, group by resource group instead of by VNet, not both.
- PaaS services without VNet integration (App Service, Functions, Cosmos DB, Storage accounts, Key Vault, Service Bus) go in the region, outside the VNet. With a private endpoint, put a `azure.private_endpoints` icon in the subnet and draw the line through it.
- Global services (Front Door, Traffic Manager, Entra ID, DNS) go in the subscription, outside every region.
- An AKS cluster lives in a subnet: put it there, with its workloads inside, as in [kubernetes.md](kubernetes.md).
- Hub-and-spoke: one VNet per hub and spoke, side by side, with peering as lines. Gateways (`azure.virtual_network_gateways`, `azure.expressroute_circuits`) and `azure.firewall` go in the hub.

## Icons

- Common names: `azure.vm`, `azure.aks`, `azure.app_service`, `azure.functions`, `azure.sql_database`, `azure.cosmos_db`, `azure.storage_account`, `azure.redis`, `azure.key_vault`, `azure.front_door`, `azure.application_gateway`, `azure.load_balancer`, `azure.firewall`, `azure.vnet`, `azure.bastions`, `azure.nat`.
- Network security groups become lines with ports, like AWS security groups. Draw them as boxes only on request.

## Reading a running subscription

Read-only commands only. Ask the user which subscription to use.

```sh
az network vnet list --subscription <id>
az network vnet subnet list --resource-group <rg> --vnet-name <vnet>
az resource list --subscription <id> --output table
az aks list --subscription <id>
az webapp list --subscription <id>
az network nsg list --subscription <id>
az network private-endpoint list --subscription <id>
```
