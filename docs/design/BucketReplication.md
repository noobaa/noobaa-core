# Bucket Replication


## GOALS
 * Data replication of objects which are stored in any NooBaa bucket (data bucket, namespace bucket) -
    * Provides a higher resiliency
    * Data buckets / namespace buckets can be backed by any supported cloud provider (S3, Azure etc)
    * The replication is one way replication - from a source NooBaa bucket to a destination NooBaa bucket.
    * Replication can be bidirectional by setting a complementing replication configuration on the destination bucket.
 * Provide the user the ability to set a replication configuration on a bucket. 

## OUT OF SCOPE
 * Versions are not replicated - only the latest version
 * Deletions are not replicated
 * Optimizations


## SOLUTION

<div id="top" />
<img src="/docs/design/images/bucket_replication.png" />

### Replication configuration schema
  * a replication policy composed of a list of replication rules,
    each rule defines rule id and a destination bucket 
    and optionally defines a filter based on the object key prefix

Structure of replication rules which was added to a new replication configuration collection schema:

```
    replication_rules: {
        type: 'array',
        items: {
            type: 'object',
            required: ['destination_bucket', 'rule_id'],
            properties: {
                rule_id: { type: 'string' },
                destination_bucket: {
                    objectid: true // bucket id
                },
                filter: {
                    type: 'object',
                    properties: {
                        prefix: { type: 'string' },
                    }
                }
            }
        }
    },
```

In addition, the bucket schema updated with a new replication_policy_id field.

### Setting changes to the replication configuration -  APIs
The end user will add changes to the bucket replication configuration by calling APIs

The following diagram APIs will be introduced:
    * put bucket replication
    * get bucket replication
    * delete bucket replication

 * put_bucket_replication - 
 This method will set the replication configuration to the bucket's entity.


 Schema of the method:
 ```
    put_bucket_replication: {
        method: 'PUT',
        params: {
            type: 'object',
            required: [
                'name', 'replication_policy'
            ],
            properties: {
                name: { $ref: 'common_api#/definitions/bucket_name' },
                replication_policy: { $ref: '#/definitions/replication_policy' },
            },
        },
        auth: {
            system: ['admin', 'user']
        }
    }
 ```

  * get_bucket_replication - 
 This method will get the replication configuration of the bucket's entity.


 Schema of the method:
 ```
    get_bucket_replication: {
        method: 'GET',
        params: {
            type: 'object',
            required: [
                'name'
            ],
            properties: {
                name: { $ref: 'common_api#/definitions/bucket_name' },
            },
        },
        reply: {
            $ref: '#/definitions/replication_policy'
        },
        auth: {
            system: ['admin', 'user']
        }
    }
 ```


 * delete_bucket_replication - 
 This method will remove the replication configuration from the bucket's entity.


 Schema of the method:
 ```
    delete_bucket_replication: {
        method: 'DELETE',
        params: {
            type: 'object',
            required: [
                'name'
            ],
            properties: {
                name: { $ref: 'common_api#/definitions/bucket_name' },
            },
        },
        auth: {
            system: ['admin', 'user']
        }
    }
 ```

### TODO: 
 * BG Worker
 * Operator side

### TESTS
 *  A new unit tests file was created for the bucket replication feature - test_bucket_replication.js

---

## Log-Based Replication

Log-based replication is an optimised alternative to the diff-based (scan) replication scanner. Instead of listing and comparing all objects across the source and destination buckets on every cycle, it reads the source bucket's operation logs and replicates only the objects that actually changed.

Three log sources are supported, selected by the `endpoint_type` in the replication policy:

| `endpoint_type` | Log source | Bucket types supported |
|---|---|---|
| `AWS` | AWS S3 Server Access Logs | Namespace buckets backed by S3 |
| `AZURE` | Azure Monitor / Log Analytics | Namespace buckets backed by Azure Blob |
| `NOOBAA` | NooBaa's own persistent bucket logging | MCG data buckets; namespace buckets (logging enabled on the underlying data bucket) |

### NooBaa Log-Based Replication

#### Overview

NooBaa's endpoint records every S3 operation as a JSON line appended to a per-node log file on disk (PERSISTENT mode). A background worker (`BucketLogUploader`) periodically rotates and uploads those files as S3 objects into a designated *log bucket*. The log replication scanner then reads those objects and drives replication.

#### Enabling NooBaa Log-Based Replication

Two things must be configured:

1. **Bucket logging** — enabled on the bucket that actually receives writes (the data bucket). The log target is the log bucket + prefix where log objects will be stored:
   ```json
   { "log_bucket": "my-log-bucket", "log_prefix": "src-bucket-logs/" }
   ```

2. **Replication policy** — set on the *source* bucket (which may be a data bucket **or** a namespace bucket in front of the data bucket). The `log_replication_info` must use `endpoint_type: "NOOBAA"` and point to the same log bucket + prefix:
   ```json
   {
     "log_replication_info": {
       "endpoint_type": "NOOBAA",
       "logs_location": {
         "logs_bucket": "my-log-bucket",
         "prefix": "src-bucket-logs/"
       }
     }
   }
   ```

#### Supported Bucket Configurations

**Case 1 — MCG data bucket as replication source**

Replication is configured on the data bucket. Logging is enabled on the same bucket. Both the replication policy and the bucket logging configuration point at the same log bucket/prefix.

```
Client → PutObject → [data-bucket] → log entry (source_bucket="data-bucket")
                                         ↓
                                    [log-bucket/prefix/...]
                                         ↓
                          LogReplicationScanner reads logs → CopyObject to dst
```

**Case 2 — Namespace bucket as replication source (logging on the underlying data bucket)**

Replication is configured on the namespace bucket. The NS layer proxies writes to the underlying data bucket, which has logging enabled. The log entries record the data bucket name, not the namespace bucket name.

```
Client → PutObject → [ns-bucket] → NS layer → [data-bucket] → log entry (source_bucket="data-bucket")
                                                                     ↓
                                                               [log-bucket/prefix/...]
                                                                     ↓
                                               LogReplicationScanner reads logs
                                               HeadObject on ns-bucket (NS layer proxies)
                                               CopyObject to dst
```

The scanner is routed to the NooBaa log path when `noobaa_log_replication_info` is present in the replication config — **regardless of whether the source bucket is a data bucket or namespace bucket**. This is the key difference from the AWS/Azure paths, which are routed by inspecting `source_bucket.namespace.write_resource.resource.connection.endpoint_type`.

The `endpoint_type` value from the API request is stripped during normalization in `bucket_server.normalize_replication()` and is not persisted.

---

### AWS Log-Based Replication

#### Overview

When the source namespace bucket is backed by an S3-compatible endpoint, NooBaa reads the cloud provider's **S3 Server Access Logs** instead of NooBaa's own bucket logs. The log objects are uploaded by AWS/S3 to a separate bucket and contain one log line per S3 operation in the [S3 Server Access Log format](https://docs.aws.amazon.com/AmazonS3/latest/userguide/LogFormat.html).

The scanner is routed to the AWS path when `aws_log_replication_info` is present in the replication config and the source bucket's namespace endpoint type is `AWS`.

#### Supported Bucket Configuration

```
Client → PutObject → [S3/RGW bucket] (remote)
                         ↓  S3 Server Access Log uploaded by cloud provider
                     [AWS log bucket/prefix/...]
                         ↓
         LogReplicationScanner (aws_get_next_log_entry + _aws_get_next_log)
         parses space-delimited log lines
                         ↓
         HeadObject on NooBaa NS bucket (NS layer proxies to S3)
         CopyObject to dst NS/data bucket
```

The source in NooBaa is a **namespace bucket** backed by an S3 resource. The replication scanner connects to the remote S3 endpoint using the access credentials from the namespace resource to fetch log objects.

### Azure Log-Based Replication

#### Overview

When the source namespace bucket is backed by Azure Blob Storage, NooBaa queries **Azure Monitor Log Analytics** (via Kusto query language) to retrieve recent storage operations. Unlike AWS and NooBaa log types, Azure logs are not fetched as S3 objects — the scanner runs a KQL query against the Azure Log Analytics workspace and receives structured query results.

The scanner is routed to the Azure path when `azure_log_replication_info` is present in the replication config and the source bucket's namespace endpoint type is `AZURE`.

#### Supported Bucket Configuration

```
Client → PutObject → [Azure Blob container] (remote)
                         ↓  Diagnostic logs sent to Log Analytics workspace
                     [Azure Monitor / Log Analytics]
                         ↓  KQL query (StorageBlobLogs)
         LogReplicationScanner (LogsQueryClient from @azure/monitor-query-logs)
         receives Write/Delete rows
                         ↓
         HeadObject on NooBaa NS bucket (NS layer proxies to Azure)
         CopyObject to dst NS/data bucket
```

