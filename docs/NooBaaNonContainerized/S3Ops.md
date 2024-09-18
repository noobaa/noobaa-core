# NooBaa Non Containerized - Supported S3 Operations


1. [Overview](#overview)
2. [Supported S3 Bucket Operations](#supported-s3-bucket-operations)
3. [Supported S3 Object Operations](#supported-s3-object-operations)
4. [Bucket Policy Support](#bucket-policy-support)
5. [Anonymous Requests Support](#anonymous-requests-support)

### Overview 

NooBaa supports a comprehensive range of S3 operations, including bucket and object management, enabling seamless integration with S3-compatible applications.
The following lists describe the bucket and object operations available in NooBaa Non Containerized.

### Supported S3 Bucket Operations

- S3 CreateBucket
- S3 ListObjects
- S3 ListObjectsV2
- S3 DeleteBucket
- S3 HeadBucket
- S3 ListBuckets
- S3 ListMultipartUploads 
- S3 PutBucketPolicy
- S3 DeleteBucketPolicy
- S3 GetBucketPolicy
- S3 GetBucketPolicyStatus
- S3 PutBucketLifecycleConfiguration
- S3 GetBucketLifecycleConfiguration
- S3 DeleteBucketLifecycle


### Supported S3 Object Operations

- S3 PutObject
- S3 GetObject
- S3 HeadObject
- S3 CopyObject
- S3 DeleteObject
- S3 DeleteObjects
- S3 CreateMultipartUpload
- S3 CompleteMultipartUpload
- S3 AbortMultipartUpload
- S3 UploadPart
- S3 UploadPartCopy
- S3 ListParts 
- S3 GetObjectTagging
- S3 PutObjectTagging
- S3 DeleteObjectTagging

### Bucket Policy Support
- Bucket policies are an access policy option available to grant permission to buckets and objects (see [bucket policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html) in AWS documentation). You can use bucket policies to add or deny permissions for the objects in a bucket. Bucket policies can allow or deny requests based on the elements in the policy.
- Bucket policies use JSON-based policy language (for more information see [basic elements in bucket policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html) in AWS documentation)
- Bucket policy can be added to a bucket using the S3 API or the noobaa-cli.
- Bucket policy is an additional layer of permissions to the FS permissions (UID and GID), which means that if two accounts do not have the same permissions (UID, GID) just setting bucket policy on the bucket is not enough.

#### Bucket Policy in NooBaa CLI
1. Adding a bucket policy:
  - On bucket creation using the command: `noobaa-cli bucket add --name <bucket_name> --owner <owner_name> --path <path> --bucket_policy <bucket-policy>`.
  - On bucket update using the command: `noobaa-cli bucket update --name <bucket_name> --bucket_policy <bucket-policy>`.
In both cases the argument for the bucket policy is a string
2. Removing a bucket policy: `noobaa-cli bucket update --name <bucket_name> --bucket_policy ''` (using empty string)
3. Get a bucket policy: `noobaa-cli bucket status --name <bucket_name>` (a bucket policy will be printed in the bucket details)

bucket_policy as a string example:
`'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["<account-name>"]},"Action":["s3:*"],"Resource":["arn:aws:s3:::<bucket-name>/*","arn:aws:s3:::<bucket-name>"]}]}'`

Replace `<account-name>` with account name and `<bucket-name>` with a bucket name.
Note: `arn:aws:s3:::<bucket-name>` for S3 bucket operations and  `arn:aws:s3:::<bucket-name>/*` for S3 object operations.
Warning: this policy allows `<account-name>` to run all S3 operations.

#### Bucket Policy in S3 API (using AWS CLI)
1. Adding bucket policy: `AWS_ACCESS_KEY_ID={access_key} AWS_SECRET_ACCESS_KEY={secret_key} aws s3api put-bucket-policy --endpoint-url {endpoint_address} --bucket {bucket_name} --policy file://policy.json`
2. Removing a bucket policy: `AWS_ACCESS_KEY_ID={access_key} AWS_SECRET_ACCESS_KEY={secret_key} aws s3api delete-bucket-policy --endpoint-url {endpoint_address} --bucket {bucket_name} --policy file://policy.json`
3. Get a bucket policy: `AWS_ACCESS_KEY_ID={access_key} AWS_SECRET_ACCESS_KEY={secret_key} aws s3api get-bucket-policy --endpoint-url {endpoint_address} --bucket {bucket_name} --policy file://policy.json`

policy.json example:
```json
{
  "Version": "2012-10-17",
  "Statement": [ 
    { 
     "Effect": "Allow", 
     "Principal": { "AWS": [ "<account-name>" ] }, 
     "Action": [ "s3:*" ], 
     "Resource": [ "arn:aws:s3:::<bucket-name>/*", "arn:aws:s3:::<bucket-name>" ] 
    }
  ]
}
```
Replace `<account-name>` with account name and `<bucket-name>` with a bucket name.
Note: `arn:aws:s3:::<bucket-name>` for S3 bucket operations and  `arn:aws:s3:::<bucket-name>/*` for S3 object operations.
Warning: this policy allows `<account-name>` to run all S3 operations.

##### Principal Field:
A bucket policy defines which principals can perform actions on the bucket. The Principal element specifies the user or account that is either allowed or denied access to a resource.
Currently we support a couple of options:
1. All principals (includes anonymous account): either `"Principal": { "AWS": "*" }` or `"Principal": "*"`.
2. Principal by account name: `"Principal": { "AWS": [ "<account-name-1>", "<account-name-2>", ... ,"<account-name-n>"] }`
3. Principal by account ID: `"Principal": { "AWS": [ "<account-ID-1>", "<account-ID-2>", ... ,"<account-ID-n>"] }`

### Anonymous Requests Support

Anonymous requests are S3 requests made without an access key or a secret key - 

* During S3 requests handling, NooBaa initiates file system operations that expect a pair of file system uid and gid. 
* When an S3 request received, NooBaa must map the requesting account's access key to uid/gid pair.
* On an anonymous S3 request, no access key or a secret key are provided, NooBaa can only map empty access key to a pre-defined anonymous user uid/gid.
* NooBaa will use the anonymous account's uid and gid or user (distinguished_name) to access bucket storage paths.  
* Currently, NooBaa supports a maximum of one anonymous account.  

Anonymous user can only access buckets that permit anonymous access, hence, before accessing a bucket using an anonymous request, a bucket policy that allows anonymous requests must be set to the bucket.


#### NooBaa CLI Anonymous user Commands
1. Create an anonymous account
    ```sh
    noobaa-cli account add --anonymous --uid {uid} --gid {gid}
    // OR
    noobaa-cli account add --anonymous --user {user}
    ```
2. Update an anonymous account
    ```sh
    noobaa-cli account update --anonymous  --uid {new_uid} --gid {new_gid}
    // OR
    noobaa-cli account update --anonymous  --user {user}
    ```

2. Delete an anonymous account
    ```sh
    noobaa-cli account delete --anonymous
    ```

2. Fetch status of an anonymous account
    ```sh
    noobaa-cli account status --anonymous
    ```

#### S3 CLI Put Bucket Policy For Allowing Anonymous Access

Follow the next steps for allowing anonymous access to a bucket - 
1. Create `Policy.json` File

    Notice - The following bucket policy allows all actions to be performed on the bucket by anonymous users, this policy is `not secure and hence unrecommended`. 

    ```sh
    > echo '{
    "Version": "2012-10-17",
    "Statement": [ 
        { 
        "Effect": "Allow", 
        "Principal": { "AWS": [ "*" ] }, 
        "Action": [ "s3:*" ], 
        "Resource": [ "arn:aws:s3:::{bucket_name}/*", 
        "arn:aws:s3:::{bucket_name}" ] 
        }
    ]
    }' > policy.json
    ```

2. Put Bucket Policy using S3api CLI
    ```sh
    AWS_ACCESS_KEY_ID={access_key} AWS_SECRET_ACCESS_KEY={secret_key} aws s3api put-bucket-policy --endpoint {endpoint} --bucket {bucket_name} --policy file:///tmp/policy.json;
    ```

3. Send anonymous requests  
    User can perform all the actions on above bucket without providing access and secret key.

    ```sh
    aws s3api list-objects --bucket {bucket_name} --endpoint {endpoint} --no-sign-request
    ```
