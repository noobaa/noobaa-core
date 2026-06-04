# Support NooBaa Glacier APIs to connect to DeepArchive-S3


### Table of Contents

* [Introduction](#introduction)
* [S3 Glacier Storage Classes Overview](#s3-glacier-storage-classes-overview)
* [Goals](#goals)
* [In Scope](#in-scope)
* [Out of Scope](#out-of-scope)
* [Stretch Goals](#stretch-goals)
* [Feature Technical Details](#feature-technical-details)
    * [Configuration](#feature-technical-details---configuration)
    * [S3 API](#feature-technical-details---s3-api) 
* [Affected Components](#affected-components)
* [Dependencies](#dependencies)
* [Effort Estimation](#effort-estimation)
* [Questions](#questions)
* [Links](#links)

---

### Introduction

AI workloads are driving rapid data growth. Customers currently pay **standard storage rates even for cold/infrequently accessed data**, leading to unnecessary cost.

IBM Deep Archive provides **tape-based, ultra-low-cost long-term storage** accessible via an S3-compatible API, using `DEEP_ARCHIVE` or `GLACIER` as the storage class designation.

This feature integrates IBM Deep Archive into NooBaa, enabling applications to **write directly to archive storage**, **transition data automatically** via lifecycle rules, and **restore archived objects** on demand — all through the standard S3 API.

---
### S3 Glacier Storage Classes Overview

The Amazon S3 Glacier storage classes -
* Stores long term, infrequently accessed data.
* Cost-effective compared to standard storage class.
* There are 3 Glacier storage classes - 
  * S3 Glacier Instant Retrieval
  * S3 Glacier Flexible Retrieval
  * S3 Glacier Deep Archive

S3 Deep Archive storage class - 
* Objects stored in this storage class are archived and not available for real-time access, takes ~12 hours to be restored.
* The lowest-cost storage option in AWS.
* Designed for retaining data sets for multiple years to meet compliance requirements.

---

### Goals


The primary goal of this epic is to integrate IBM Deep Archive as a supported cold storage class within NooBaa by exposing archive field in NamespaceStore CRD, archivePolicy field in BucketClass CRD, and extend NooBaa CLI, While enabling permissioned users to manage deep archive data via S3 APIs.

---

### In Scope - Configuration

* CRD changes - 
  - Add new optional `archive` boolean field to `NamespaceStore` CRD.
  - Add new optional `archivePolicy` field to `BucketClass` CRD. Can be added to existing bucketclasses.
- CLI - extend the existing `namespacestore` and `bucketclass` commands to support the new archive fields.

---

### In Scope - S3 API

- Write objects directly to deep archive - when received `StorageClass=DEEP_ARCHIVE` header.
- Restore Object - create a temporary copy of the archived object to standard storage class.
  - Extend bucket policy support to include the `s3:RestoreObject` action, enabling permission-based control over who can initiate object restores.
- Extend Bucket lifecycle to allow automatic transition of objects from standard to deep archive based on bucket lifecycle transition rules.
- Other S3 APIs.

---

### Out of Scope

- Support for non-IBM Deep Archive glacier endpoints (AWS Glacier, GCS Archive, etc.)
- Restore API will not support - 
  - bulk tier
  - outputLocation
  - batch
- Restore Quota per account
- Setting replication policy and lifecycle transition policy on the same bucket.

---
### Stretch Goals

- Metrics for Lifecycle Transition Actions
- Bucket Notifications for Transition & Restore Actions
- Bucket Logging for Transition Actions

---

### Feature Technical Details - Configuration

An `archive` boolean is added to `NamespaceStoreSpec`:

```go
// NamespaceStoreSpec defines the desired state of NamespaceStore
type NamespaceStoreSpec struct {
    // S3Compatible specifies a namespace store of type s3-compatible
    // +optional
    S3Compatible *S3CompatibleSpec `json:"s3Compatible,omitempty"`

    // Archive marks this namespace store as a deep-archive (Glacier) endpoint.
    // When true, the store can only be referenced via archivePolicy on a placement
    // BucketClass; it cannot be used in a namespace policy or as an account default resource.
    // +optional
    Archive bool `json:"archive,omitempty"`
}
```
---
### Feature Technical Details - Configuration

An `archive` boolean is added to `NamespaceStoreSpec`:
```go
// S3CompatibleSpec specifies a namespace store of type s3-compatible
type S3CompatibleSpec struct {
    // TargetBucket is the name of the target S3 bucket
    TargetBucket string `json:"targetBucket"`

    // Secret refers to a secret that provides the credentials.
    // The secret should define AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
    Secret corev1.SecretReference `json:"secret"`

    // Endpoint is the S3 compatible endpoint: http(s)://host:port
    Endpoint string `json:"endpoint"`

    // SignatureVersion specifies the client signature version to use when signing requests.
    // +optional
    SignatureVersion S3SignatureVersion `json:"signatureVersion,omitempty"`
}
```

---

### Feature Technical Details - Configuration

Example NamespaceStore CR:
```yaml
apiVersion: noobaa.io/v1alpha1
kind: NamespaceStore
metadata:
  name: ibm-deep-archive-store
spec:
  type: s3-compatible
  s3Compatible:
    targetBucket: my-archive-bucket
    endpoint: https://s3.us-south.cloud-object-storage.appdomain.cloud
    signatureVersion: v2
    secret:
      name: ibm-deep-archive-credentials
      namespace: openshift-storage
  archive: true
```

---

### Feature Technical Details — Configuration

New optional `archivePolicy` field added to `BucketClassSpec`:

```go
// ArchivePolicy configures a deep-archive namespace store as the cold-storage
// target for a placement-policy BucketClass.
type ArchivePolicy struct {
    // DeepArchiveResource is the name of the ibm-deep-archive NamespaceStore with archive: true.
    DeepArchiveResource string `json:"deep_archive_resource"`
}
```

---

### Feature Technical Details - Configuration

Example BucketClass CR:
```yaml
apiVersion: noobaa.io/v1alpha1
kind: BucketClass
metadata:
  name: archive-bucketclass
spec:
  placementPolicy:
    tiers:
      - backingStores:
          - standard-backing-store
  archivePolicy:
    deepArchiveResource: ibm-deep-archive-store   # must have spec.archive: true
```

---

### Feature Technical Details - Configuration

* In this version, `archive: true` is only supported on s3-compatible namespace stores.
* A NamespaceStore with `archive: true` can only be referenced via `archivePolicy` — it cannot be used in a `namespacePolicy` or as an account's `defaultResource`.
* `archive: true` is immutable after creation (changing it would silently orphan archived objects).
* NooBaa will reject creating 2 NamespaceStores with `archive: true` pointing to the same endpoint and target bucket.
* `placementPolicy` must be present on any BucketClass that sets `archivePolicy`; it configures the standard storage tier.
* The referenced namespacestore in `archivePolicy` must have `spec.archive: true`. Validation enforces this at the CLI /admission and reconcile time.
* OBC Deletion — When reclaiming an OBC, NooBaa will delete all the bucket's objects from the archive store.

---

### Feature Technical Details — S3 API

| Operation | Behavior |
|-----------|----------|
| **PutObject / CompleteMultipartUpload** - (storageClass=DEEP_ARCHIVE)| Create a DB entity for the object metadata and passthrough the data to IBM Deep Archive namespace resource
| **RestoreObject** | Updates the object's restore_status to be ongoing and will call S3 RestoreObject on the Deep Archive, while the background worker will create the temporary copy of the archived object to standard storage class. If already restored, extend the expiry_time. Allowed for bucket owner/ permissioned accounts - `s3:RestoreObject` permission.|
| **PutBucketLifecycleConfiguration** | Processes and stores `Transition` / `NonCurrentVersionTransition` lifecycle actions |
| **GetBucketLifecycleConfiguration** | Return value includes `Transition` / `NonCurrentVersionTransition` elements |

---

### Feature Technical Details — S3 API

| Operation | Behavior |
|-----------|----------|
| **HeadObject** | Returns `x-amz-storage-class: DEEP_ARCHIVE` and `x-amz-restore` header from `restore_status` |
| **GetObject** | If object not restored - throws `InvalidObjectState` error. Else, reads from standard copy when `restore_status.expiry_time` is set and not expired |
| **GetObjectAttributes** | Returns `StorageClass` from object metadata |
| **ListObjects** | Served from object metadata — no direct IBM Deep Archive query |
| **CopyObject** - (source archived) | If object not restored - throws `InvalidObjectState` error. Else, copies the temporary copy from standard to standard/deep archive when target's `storageClass=DEEP_ARCHIVE` |
| **DeleteObject** | Deletes the object metadata and eventually passthrough delete to IBM Deep Archive endpoint to avoid orphaned data |

---

## Feature Technical Details — S3 Lifecycle Transition Rules

S3 Lifecycle rules allow automatic movement of objects between standard to Deep Archive storage classes over time.  
Users configure them via `PutBucketLifecycleConfiguration`.

`Transition` action key fields: 
- **StorageClass** - `DEEP_ARCHIVE`
- **Days** - the number of days after creation of an object before transitioning the object to Deep Archive.
- **Date** - absolute date when transitioning the object to Deep Archive. 

`NonCurrentVersionTransition` action key fields:
- **StorageClass** - `DEEP_ARCHIVE`
- **NewerNoncurrentVersions** - how many noncurrent versions will retain in the standard storage class before transitioning object to Deep Archive.
- **NoncurrentDays** - the number of days an object is noncurrent before transitioning the object to Deep Archive.

Note - All other lifecycle rule fields — such as expiration and filter — remain fully supported and work in conjunction with the new transition rules.

---
Example - 
```xml
<LifecycleConfiguration>
  <Rule>
    <ID>move-to-deep-archive</ID>
    <Status>Enabled</Status>
    <Filter>
      <Prefix>logs/</Prefix>
    </Filter>
    <Transition>
      <Days>90</Days>
      <StorageClass>DEEP_ARCHIVE</StorageClass>
    </Transition>
    <NoncurrentVersionTransition>
      <NoncurrentDays>30</NoncurrentDays>
      <StorageClass>DEEP_ARCHIVE</StorageClass>
    </NoncurrentVersionTransition>
  </Rule>
</LifecycleConfiguration>
```
---

### Feature Technical Details — Lifecycle Transition

The existing lifecycle bg worker currently **skips** `Transition` / `NoncurrentVersionTransition` rules.

**New behavior -**
1. Read transition lifecycle rules per bucket, gate on bucket having `archive_resources`
2. For each object that should be transitioned:
   - Set the object's transition_status to be `in_progress`
   - Read object data from standard storage class
   - Writes object data to IBM Deep Archive (S3-compatible write, per-request timeout)
   - Update object DB metadata fields - `storage_class = 'DEEP_ARCHIVE'`, `transition_status = "done"`, `data_expired = "timestamp"` 
3. The already existing object reclaimer BG worker will do the actual data deletion

**Notes -**
* The lifecycle BG worker works in batches
* Per-object errors - log and **continue** — do not abort the bucket's transition run, retry on next cycle.
* Object's metadata **is not deleted** - `storage_class = DEEP_ARCHIVE` signals archive location to all S3 operations

---

### Feature Technical Details — Restore & Expiry

**Deep Archive Restore is async** — IBM Deep Archive (tape) retrieval takes up to 12 hours.

**RestoreObject API** - Set object's metadata `restore_status = { ongoing: true }` and will call S3 RestoreObject on deep archive / extend the expiry_time if already restored and return immediately.

**Restore BG Worker** - 
1. Iterate over objects metadata that their restore_status is ongoing, for each -
    * call headObject to fetch the status from the deep archive
    * when restored on deep archive -
       * getObject from deep archive 
       * write the data to standard storage class
       * update the object's metadata `restore_status={ ongoing: false, expiry_time: Days+now }`

**Restore Expiry BG Worker**
Fetches from NooBaa DB expired temporary restored objects and sets data_expired to timestamp. 
The already existing object reclaimer BG worker will do the actual data deletion and will reset the restore status

---

### Affected Components

1. noobaa-core
2. noobaa-operator
3. noobaa-cli
4. UI

---

## Dependencies

- IBM Deep Archive endpoint - Must be S3-compatible and accessible from the cluster
- Versioning — NooBaa will support transitioning and restoring versioned objects to Deep Archive. Full versioning support depends on IBM Deep Archive enabling versioning on their end.

---

## Effort Estimation

XL

---

## Questions

---

## Links

* [IBM Deep Archive documentation](https://www.ibm.com/products/deep-archive#:~:text=Standardized%20interface%20to%20tape%20utilizing%20the%20S3%20Glacier%20storage%20classes%20for%20all%20supported%20object%20data%20on%20a%20scalable%20infrastructure.)

AWS documentation - 
* [Understanding S3 Glacier storage classes for long-term data storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/glacier-storage-classes.html)
* [Amazon S3 Glacier storage classes](https://aws.amazon.com/s3/storage-classes/glacier/)
* [Understanding archival storage in S3 Glacier Deep Archive](https://docs.aws.amazon.com/AmazonS3/latest/userguide/archival-storage.html)
* [Working with archived objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/archived-objects.html)
* [Understanding archive retrieval options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html)
* [Restoring an archived object](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects.html)
* [RestoreObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_RestoreObject.html)
* [Managing the lifecycle of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
* [Transitioning objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)
* [PutBucketLifecycleConfiguration API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutBucketLifecycleConfiguration.html)
* [S3 lifecycle event notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-configure-notification.html)
* [S3 lifecycle and logging](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-and-other-bucket-config.html#lifecycle-general-considerations-logging)
* [Understanding and managing Amazon S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)
* [Storage classes for rarely accessed objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html#sc-glacier)
* [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html)
* [Restore-object CLI documentation](https://docs.aws.amazon.com/cli/latest/reference/s3api/restore-object.html)

