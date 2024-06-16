# NooBaa Non Containerized - Supported S3 Operations


1. [Overview](#overview)
2. [Supported S3 Bucket Operations](#supported-s3-bucket-operations)
3. [Supported S3 Object Operations](#supported-s3-object-operations)
4. [Anonymous Requests Support](#anonymous-requests-support)

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
