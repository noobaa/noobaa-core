[NooBaa Core](../README.md) /

# Bucket Replication
Bucket replication is a NooBaa feature that allows a user to set a replication policy for all or some objects. The goal of replication policies is simple - to define a target bucket for objects to be copied to.

To utilize bucket replication, we need to first decide what will be our source bucket and what will be our target bucket. The source bucket is the bucket that contains the objects that we want to replicate, and the target bucket is the bucket that will contain the replicated objects. The replication policy is set on the source bucket, and it defines the target bucket(s) and the rules for replication.

In general, a replication policy is a JSON-compliant string which defines an array containing at least one rule  -
  - Each rule is an object containing a `rule_id`, a `destination_bucket`, and an optional `filter` key that contains a `prefix` field.
  - When a filter with prefix is provided - only objects keys that match the prefix will be replicated

Behind the scenes, bucket replication esstentialy works by comparing object lists. NooBaa lists all objects on the source and target buckets, and checks which objects are missing on the target bucket. It then copies the missing objects from the source to the target bucket (while adhering to any provided rules).

It is possible to accelerate replication by utilizing logs - at the time of writing this document, AWS S3 server access logging or Azure Monitor. This mechanism allows NooBaa to copy only objects that have been created or modified since the feature was turned on, while the rest replicate in the background. This allows users to get up to speed with recent objects, while the classic replication mechanism catches up with the rest.

## Bucket Class Replication
Bucket replication policies can also be applied to a bucketclasses. In those cases, the policy will automatically be 'inherited' by all bucket claims that utilize the bucketclass in the future.

## Replication Policy Parameters
As stated above, a replication policy is a JSON-compliant array of rules (examples are provided at the bottom of this section)
  - Each rule is an object that contains the following keys:
    - `rule_id` - a unique ID which is used to identify the rule. The rule should utilize classic alphanumeric characters (a-zA-Z0-9) and is chosen by the user. Note that is not possible to create several rules with the same ID.
    - `destination_bucket` - which dictates the target NooBaa buckets that the objects will be copied to
    - (Optional) `{"filter": {"prefix": <>}}` - if the user wishes to filter the objects that are replicated, the value of this field can be set to a prefix string
    - (Optional, AWS-only, log-based optimization) `sync_deletions` - can be set to a boolean value to indicate whether deletions should be replicated (i.e. objects that were deleted on the source bucket should be deleted on the target bucket)
    - (Optional, AWS-only, log-based optimization) `sync_versions` - can be set to a boolean value to indicate whether object versions should be replicated (i.e. if the source bucket has versioning enabled, the target bucket will also have versioning enabled, and all object versions will be synced)

In addition, when the bucketclass is backed by namespacestores, each policy can be set to optimize replication by utilizing logs (configured and supplied by the user, currently only supports AWS S3 and Azure Blob):
  - (Optional, only supported on namespace buckets) `log_replication_info` - an object that contains data related to log-based replication optimization -
    - (Necessary on Azure) `endpoint_type` - this field can be set to an appropriate endpoint type (currently, only AZURE is supported)
    - (Necessary on AWS) `{"logs_location": {"logs_bucket": <>}}` - this field should be set to the location of the AWS S3 server access logs

## Design
The design document can be found [here](design/BucketReplication.md)

## Examples
There are two ways to apply a bucket/bucketclass replication policy:

The first is with the NooBaa CLI (requires the policies to be saved as a separate JSON file and passed to the CLI) - for example:
#### Namespace bucketclass creation via the NooBaa CLI with replication to first.bucket:
```shell
noobaa -n app-namespace bucketclass create namespace-bucketclass single bc --resource azure-blob-ns --replication-policy=/path/to/json-file.json
```
/path/to/json-file.json is the path to a JSON file which defines the replication policy, e.g. -
```json
{"rules":[{ "rule_id": "rule-1", "destination_bucket": "first.bucket", "filter": {"prefix": "d"}} ]}
```

The second is by applying a YAML file containing the policy.
It's also possible to apply a replication policy to OBCs even after their creation (although the same thing is not possible with bucketclasses).
For OBCs, the policy needs to be provided under the `spec.additionalConfig.replicationPolicy` property. For example:

#### ObjectBucketClaim creation via YAML file with replication to first.bucket:
```yaml
apiVersion: objectbucket.io/v1alpha1
kind: ObjectBucketClaim
metadata:
  name: my-bucket-claim
  namespace: appnamespace
spec:
  generateBucketName: my-bucket
  storageClassName: noobaa.noobaa.io
  additionalConfig:
    replicationPolicy: '[{ "rule_id": "rule-2", "destination_bucket": "first.bucket", "filter": {"prefix": "bc"}}]'
```

For bucketclasses, the policy should be provided under `spec.replicationPolicy`- for example:
#### Bucketclass creation via YAML file with replication to first.bucket:
```yaml
apiVersion: noobaa.io/v1alpha1
kind: BucketClass
metadata:
  name: bc
  namespace: app-namespace
spec:
  namespacePolicy:
    type: Single
    single: 
      resource: azure-blob-ns
  replicationPolicy: '[{ "rule_id": "rule-1", "destination_bucket": "first.bucket", "filter": {"prefix": "ba"}}]'
```

A few more rules for example:

#### AWS replication policy with a prefix filter:
`'{"rules":[{"rule_id":"aws-rule-1", "destination_bucket":"first.bucket", "filter": {"prefix": "a."}}]}'`

#### AWS replication policy with log optimization, deletion and version sync:
`'{"rules":[{"rule_id":"aws-rule-1", "sync_deletions": true, "sync_versions": true, "destination_bucket":"first.bucket"}], "log_replication_info": {"logs_location": {"logs_bucket": "logsarehere"}}}'`


#### Azure replication policy with log optimization:
`'{"rules":[{"rule_id":"azure-rule-1", "destination_bucket":"first.bucket"}], "log_replication_info": {"endpoint_type": "AZURE"}}'`
