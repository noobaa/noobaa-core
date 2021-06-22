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
