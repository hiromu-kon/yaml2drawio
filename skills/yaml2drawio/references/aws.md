# AWS conventions

## Boundaries

Nest them in this order, leaving out levels that add nothing:

`aws.account` (only when several accounts appear) > `aws.cloud` > `aws.region` > `aws.vpc` > `aws.az` > `aws.public_subnet` or `aws.private_subnet`

- Global services (CloudFront, Route 53, IAM Identity Center, WAF on CloudFront, Shield) go inside `aws.cloud` but outside every region.
- Regional services without a VPC (S3, DynamoDB, SQS, SNS, EventBridge, Lambda without `vpc_config`) go inside the region, outside the VPC.
- Draw every subnet the code defines, as an empty group when nothing in the diagram runs in it.

## Inside a VPC

- Internet gateway on the VPC's `border` at `n`. VPC endpoints on the VPC's `border` at `e`, `ene` or `ese`. Transit gateway or VPN gateway on the `border` at `w`.
- A load balancer spans its subnets: draw it once, inside the VPC above the row of AZs.
- An ECS service, Auto Scaling group or EKS node group: one icon per private subnet it runs in.
- Aurora or RDS Multi-AZ: the writer in one AZ and the reader or standby in the other. ElastiCache: primary and replica the same way.
- NAT gateways: one per public subnet that has one.
- Security groups: lines with ports by default (see terraform.md). As boxes only on request: wrap the icon in each subnet in an `aws.security_group` group with the group's name.

## Icons

- Use the service icon (`kind` service in `icons` output, such as `aws.ecs`) for the main resources, and a resource icon (`kind` resource, such as `aws.nat_gateway` or `aws.aurora_instance`) when the specific part matters.
- `aws.users` for people, `aws.client` or `aws.mobile_client` for their devices, `aws.internet` for the internet.

## Reading a running account

Read-only commands only. Ask the user which account, profile and region to use.

```sh
aws ec2 describe-vpcs
aws ec2 describe-subnets
aws ec2 describe-nat-gateways
aws ec2 describe-security-groups
aws elbv2 describe-load-balancers
aws ecs list-clusters
aws ecs describe-services --cluster <cluster> --services <service>
aws rds describe-db-clusters
aws elasticache describe-replication-groups
aws lambda list-functions
aws cloudfront list-distributions
```
