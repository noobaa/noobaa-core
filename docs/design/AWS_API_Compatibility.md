[NooBaa Core](../../README.md) /

# AWS APIs Compatibility Table
The chart below strives to provide an up-to-date overview of which AWS API calls are supported by NooBaa, and to what extent.
Actions that are absent from the table are entirely unsupported*.
The table is split into categories, each containing a list of features and their corresponding API actions.
NooBaa utilizes different implementations of API calls for different storage providers, so the table is split into columns for each provider to indicate whether it's supported or not.
The store types currently included in the table are backingstore (regardless of storage provider), namespace filesystem (NSFS), namespace for Amazon Web Services, and namespace for Microsoft Azure.
For more information, see [S3 Compatibility](https://github.com/noobaa/noobaa-operator/tree/master/doc/s3-compatibility.md), [Bucket Types](https://github.com/noobaa/noobaa-operator/tree/master/doc/bucket-types.md), [Backingstore CRD](https://github.com/noobaa/noobaa-operator/blob/master/doc/backing-store-crd.md) and [Namespacestore CRD](https://github.com/noobaa/noobaa-operator/blob/master/doc/namespace-store-crd.md).

_* Note that it is also possible for actions to be supported but absent because the table was not updated._

| Category              | Feature                         | API Action                        | Backingstore  | NSFS   |  NS AWS |  NS Azure  | Comments                                                                |
|:---------------------:|:-------------------------------:|:---------------------------------:|:-------------:|:------:|:-------:|:----------:|-------------------------------------------------------------------------|
| **Basic**             | Bucket                          | HeadBucket                        | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Bucket                          | CreateBucket                      | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Bucket                          | DeleteBucket                      | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Bucket                          | ListBuckets                       | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Bucket                          | GetBucketLocation                 | ✅            | ✅    | ✅*     | ✅*       | *Always returns an empty string                                         |
|                       | Object                          | HeadObject                        | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Object                          | GetObject                         | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Object                          | PutObject                         | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Object                          | DeleteObject                      | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Object                          | DeleteObjects                     | ✅            | ✅    | ✅      | ❌        |                                                                         |
|                       | Object                          | ListObjects                       | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Object                          | ListObjectsV2                     | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Object                          | CopyObject                        | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Object                          | GetObjectAttributes               | ✅*           | ✅*   | ✅      | ✅*        | *Partially implemented                                                  |
|                       | Multipart Upload                | CreateMultipartUpload             | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Multipart Upload                | CompleteMultipartUpload           | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Multipart Upload                | AbortMultipartUpload              | ✅            | ✅    | ✅      | ✅*       | *Azure does not support aborting uploads, so the operation is ignored and Azure will clean up the parts after 7 days |
|                       | Multipart Upload                | ListMultipartUploads              | ✅            | ✅    | ✅      | ❌        |                                                                         |
|                       | Multipart Upload                | ListParts                         | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Multipart Upload                | UploadPart                        | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Multipart Upload                | UploadPartCopy                    | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Tagging                         | GetObjectTagging                  | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Tagging                         | PutObjectTagging                  | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Tagging                         | DeleteObjectTagging               | ✅            | ✅    | ✅      | ✅        |                                                                         |
|                       | Tagging                         | GetBucketTagging                  | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Tagging                         | PutBucketTagging                  | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Tagging                         | DeleteBucketTagging               | ✅            | ✅    | ❌      | ❌        |                                                                         |
| **Permissions**       | ACL                             | GetBucketAcl                      | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use BucketPolicy instead                                |
|                       | ACL                             | PutBucketAcl                      | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use BucketPolicy instead                                |
|                       | ACL                             | GetObjectAcl                      | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use BucketPolicy instead                                |
|                       | ACL                             | PutObjectAcl                      | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use BucketPolicy instead                                |
|                       | Bucket Policy                   | GetBucketPolicy                   | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Bucket Policy                   | GetBucketPolicyStatus             | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Bucket Policy                   | PutBucketPolicy                   | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Bucket Policy                   | DeleteBucketPolicy                | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | CORS                            | GetBucketCORS                     | ✅            | ✅    | ❌      | ❌        |                                                                         |                                                     
|                       | CORS                            | PutBucketCORS                     | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | CORS                            | DeleteBucketCORS                  | ✅            | ✅    | ❌      | ❌        |                                                                         |
| **Data Protection**   | Versioning                      | GetBucketVersioning               | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Versioning                      | PutBucketVersioning               | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Versioning                      | ListObjectVersions                | ✅            | ✅    | ✅      | ❌        |                                                                         |
| **Monitoring**        | Notifications                   | GetBucketNotification             | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use NotificationConfiguration instead                   |
|                       | Notifications                   | PutBucketNotification             | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use NotificationConfiguration instead                   |
|                       | Notifications                   | GetBucketNotificationConfiguration| ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Notifications                   | PutBucketNotificationConfiguration| ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Logging                         | GetBucketLogging                  | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Logging                         | PutBucketLogging                  | ✅            | ✅    | ❌      | ❌        |                                                                         |
| **Tiering**           | Lifecycle                       | GetBucketLifecycle                | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use LifecycleConfiguration instead                      |
|                       | Lifecycle                       | PutBucketLifecycle                | ❌            | ❌    | ❌      | ❌        | DEPRECATED API: use LifecycleConfiguration instead                      |
|                       | Lifecycle                       | GetBucketLifecycleConfiguration   | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Lifecycle                       | PutBucketLifecycleConfiguration   | ✅*           | ✅*   | ❌      | ❌        | *Partial (no storage-class Transitions). ** Additional automation setup is needed |
|                       | Lifecycle                       | DeleteBucketLifecycle             | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Glacier                         | RestoreObject                     | ❌            | ✅*   | ❌      | ❌        | *Additional automation setup is needed (provided by IBM Deep Archive)   |
| **Web Hosting**       | Website                         | GetBucketWebsite                  | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Website                         | PutBucketWebsite                  | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Website                         | DeleteBucketWebsite               | ✅            | ✅    | ❌      | ❌        |                                                                         |
| **Security**          | Encryption                      | GetBucketEncryption               | ✅            | ✅    | ❌      | ❌        |                                                                         |
|                       | Encryption                      | PutBucketEncryption               | ✅            | ✅*   | ❌      | ❌        | *Additional automation setup is needed (NooBaa only verifies that the FS encryption matches the bucket configuration |
|                       | Encryption                      | DeleteBucketEncryption            | ✅            | ✅    | ❌      | ❌        |                                                                         |
| **STS API**           | Session Tokens                  | AssumeRole                        | ✅            | ✅    | ❌      | ❌        |                                                                         |
| **IAM API***           | Users                          | GetUser                           | ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Users                           | CreateUser                        | ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Users                           | UpdateUser                        | ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Users                           | DeleteUser                        | ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Users                           | ListUsers                         | ❌            | ✅*   | ❌      | ❌        | *No pagination support                                                  |
|                       | Access Keys                     | GetAccessKeyLastUsed              | ❌            | ✅*   | ❌      | ❌        | *Partially implemented                                                  |
|                       | Access Keys                     | CreateAccessKey                   | ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Access Keys                     | UpdateAccessKey                   | ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Access Keys                     | DeleteAccessKey                   | ❌            | ✅    | ❌      | ❌        |                                                                         |
|                       | Access Keys                     | ListAccessKeys                    | ❌            | ✅*   | ❌      | ❌        | *No pagination support                                                  |

_* IAM API uses a different port than the S3 API, and needs to be manually enabled prior to use._