# Reading Terraform and OpenTofu

The same approach works for every provider (`aws_`, `google_`, `azurerm_`); only the resource names differ.

## Find the resources

```sh
grep -rnE '^(resource|module|data) ' --include='*.tf' .
```

- **Local modules** (`source = "./modules/..."`): read them too; their resources belong to the diagram.
- **Registry modules**: read the inputs. For example `terraform-aws-modules/vpc/aws` with `azs`, `public_subnets` and `private_subnets` creates one subnet per AZ and list entry, and a NAT gateway when `enable_nat_gateway = true`.
- **`count` and `for_each`**: when the copies map to subnets or zones, draw one icon per subnet. Otherwise draw one icon and put the count in the label (`Workers ×3`).
- **Resolved values**: if a plan or state file already exists, `terraform show -json <file>` prints concrete values. Do not run `init`, `plan` or `apply` without asking; they need credentials and may change things.

## Where a resource goes

Follow the references that pin it to a network:

| Look for                                                                      | It means                                |
| ----------------------------------------------------------------------------- | --------------------------------------- |
| `subnet_id`, `subnets`, `subnet_ids`, `vpc_config`, `network_configuration`   | inside those subnets, so in their zones |
| a DB or cache subnet group                                                    | inside the subnets of the group         |
| `availability_zone` on a subnet                                               | the zone group that holds the subnet    |
| `map_public_ip_on_launch = true`, or a route to an internet gateway           | a public subnet                         |
| no network reference (S3, DynamoDB, SQS, most serverless and global services) | outside the network                     |

## What connects to what

| Evidence                                                                                                                                                               | Line                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A security group rule admitting another security group (`source_security_group_id`, `referenced_security_group_id`, `security_groups` in an `ingress` block) on a port | from the resources in the source group to the resources in this group, labeled with the port |
| A load balancer target group used by a service (`load_balancer { target_group_arn }`) or attached to instances                                                         | load balancer to the service                                                                 |
| CloudFront `origin { domain_name }`                                                                                                                                    | CDN to the origin                                                                            |
| Event sources: `aws_lambda_event_source_mapping`, SNS subscriptions, S3 bucket notifications, EventBridge targets, Pub/Sub subscriptions                               | source to target                                                                             |
| An endpoint, URL or ARN passed in environment variables or parameters                                                                                                  | the resource to what it points at, dashed if it is only configuration                        |
| Replication settings (global databases, cross-region replication)                                                                                                      | primary to replica, dashed, labeled                                                          |

Security groups and firewall rules are the best evidence for traffic between resources. Use them for lines even when you do not draw the groups as boxes.
