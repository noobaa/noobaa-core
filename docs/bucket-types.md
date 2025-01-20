[NooBaa Core](../README.md) /

# Bucket Types in NooBaa
NooBaa supports two types of buckets - most commonly referred to as `namespace` and `data`. While all NooBaa buckets are accessible via the S3 API and appear the same to the user, they have different uses and implementations under the hood.
This document will explain the meaning of each, as well as the differences between the two.

## Data Buckets
Data buckets are the 'classic' type of bucket in NooBaa. In a classic NooBaa deployment, the product creates several resources by default - a backingstore (`noobaa-default-backing-store`), a bucketclass (`noobaa-default-bucket-class`) and a bucket (`first.bucket`) as part of the product's initialization process. When data is written to data buckets, it is first processed by NooBaa - the data is compressed, deduplicated, encrypted, and split into chunks. These chunks are then stored in the backingstore that the bucket is connected to.
The only way to access the objects on data buckets is through NooBaa - the chunks cannot be used or deciphered without the system.

## Namespace Buckets
Namespace buckets work differently than data buckets, since they try¹ to not apply any processing on the objects that are uploaded to them, and act as more of a 'passthrough'. In cases where a non-S3 storage provider API is used, NooBaa takes care of bridging potential gaps between S3 and the provider's API - no user action is required. This also means that as long as NooBaa supports a certain provider's API, users can use the S3 API to manage it (while NooBaa takes care of the 'translation').

The objects can be accessed both from within NooBaa, as well as from whatever storage providers hosts them.
Namespace buckets also support having multiple 'read' sources - for example, a single namespace bucket can show the objects from several Azure Blob containers, AWS S3 buckets, Google Cloud Platform buckets, all at the same time.
Another feature of namespace buckets is cache, which can be configured to keep frequently-accessed objects in the system's memory, effectively reducing access time as well as egress and access costs.

_1. In some cases, object metadata (such as tags) might have to be modified in order to comply with a cloud provider's limits_

## Supported Storage Providers by Bucket Type
| Service                                           | Data Buckets | Namespace Buckets |
|---------------------------------------------------|     :---:    |        :---:      |
| Amazon Web Services S3 (AWS)                      | ✅          | ✅
| S3 Compatible Services                            | ✅          | ✅
| IBM Cloud Object Storage (COS)                    | ✅          | ✅
| Azure Blob Storage                                | ✅          | ✅
| Google Cloud Platform Object Storage (GCP)        | ✅          | ❌
| Filesystem (NSFS)                                 | ❌          | ✅
| Persistent Volume Pool (PV)                       | ✅          | ❌

For specific API calls (including non-S3 calls, such as IAM), you can check [AWS API Compatibility](design/AWS_API_Compatibility.md)

_Please note that the table above might be out of date, or have additional support that is not present in older versions - the best way to check if a storage provider is supported is to run the NooBaa CLI tool (that fits the NooBaa version installed on the cluster) with a command such as `noobaa namespacestore create` or `noobaa backingstore create` and see which providers are listed in the help message._

## Buckets in Relation to Bucketclasses and Stores
In order to connect NooBaa to a storage provider (regardless of whether it's a cloud provider or an on-premises storage system), a store must be created - either a [backingstore](https://github.com/noobaa/noobaa-operator/blob/master/doc/backing-store-crd.md), or a [namespacestore](https://github.com/noobaa/noobaa-operator/blob/master/doc/namespace-store-crd.md). A store signifies a connection to a storage provider - it requires credentials, and sometimes additional configuartion such as a custom endpoint (when utilizing S3 compatible services that use the S3 API but aren't AWS. For example, Google's S3-compatible Cloud Storage URI is https://storage.googleapis.com).
The type of store chosen determines what type of buckets will be created on top of it -
- Namespacestores are used to create namespace buckets
- Backingstores are used to create data buckets

Once a store is created, it's necessary to create a [bucketclass](https://github.com/noobaa/noobaa-operator/blob/master/doc/bucket-class-crd.md) resource in order to utilize it. Bucketclasses allow users to define bucket policies relating to data placement and replication, and are used as a middle layer between buckets and stores.

After the bucketclass has been created, it's now finally possible to create an [object bucket claim](https://github.com/noobaa/noobaa-operator/blob/master/doc/obc-provisioner.md), which is then reconciled by NooBaa and creates a bucket in the system. The created bucket can then be interacted with via the S3 API. 

For further reading on S3 API compatibility, see the [S3 Compatibility](s3-compatibility.md) document.