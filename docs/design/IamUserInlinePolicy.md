# IAM User Policy
In a containerized deployment, we added the IAM user policy.  
When used, it adds a layer of permission to the users under the account.  
We decided that IAM user inline policies are checked for authorization only in S3 operations (`src/endpoint/s3/s3_rest.js`).

## User Without IAM User Policy
User must have IAM policy to be authorized for S3 operations.

## User With IAM User Policy
The user’s inline policy is embedded in the user.  
If a user has a user policy, the ability to perform an S3 operation is based on his user inline policy.

### Supported IAM User Inline Policies Operations
- IAM PutUserPolicy:  UserName, PolicyDocument, PolicyName
- IAM DeleteUserPolicy: UserName, PolicyName
- IAM GetUserPolicy: UserName, PolicyName
- IAM ListUserPolicies: UserName

#### Put User Policy Notes
- Like AWS, we do not validate the policy JSON, which means that a user can have invalid user policies.
- The policy JSON structure is the same as the bucket policy except for 2 differences:  
    (1) There is no field of `Principal` in the JSON, as the policy is embedded in a user.  
    (2) We do not support the `Condition` field (as we decided at this point).  
(for additional information, see the schema `iam_user_policy_document` in `common_api`).  
- The limitation for the IAM policies is the total size of all the policies on a user.
- If a user had a policy and the account root user put a different user policy document with the same name, then the policy will be replaced.

#### Under The Hood
For every S3 request, authorization (`authorize_request` in `src/endpoint/s3/s3_rest.js`) is performed.
The authorization now will have:
1. Authorization handle for signed request and anonymous requests.  
2. Authorization handle according to the user IAM policy (the new added layer - only for IAM users).  
3. Authorization handle according to bucket policy.  

If one of the layers does not permit it would result in `AccessDenied` error.

Since the structure of the policy document of bucket policy and IAM user policy is similar (but not identical), the decision of whether the request is authorized to perform the S3 operation by using the same functions as bucket policy (except for the difference that was mentioned before - we do not check `Condition` and `Principal` fields).

We check if the IAM policy has explicit `DENY`, otherwise, we look for explicit `ALLOW`.
If we have an IAM policy and we didn’t have both, then it is an `IMPLICIT_DENY` and it would result in an `AccessDenied` error.

## Demo
Use an account (either it’s the admin account or a newly created one from the CLI).  
In S3: the account creates a bucket.  
In IAM: the account creates a user, an access key, and puts a user inline policy.  
Check the ability of the user to perform S3 operations according to the IAM policy.  

1. Create the alias for the account: 
- `alias account-s3=’AWS_ACCESS_KEY=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url <endpoint-url-s3>`
- `alias account-iam=‘AWS_ACCESS_KEY=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url <endpoint-url-iam>’`
2. Check the connection to the endpoint:
- Try to list the users (should be an empty list if any user was not created): `account-iam iam list-users; echo $?`
- Try to list the buckets: `account-iam s3 ls; echo $?`
3. Create a bucket: `account-s3 is3 mb s3://bucket-account`
4. Create a user: `account-iam iam create-user --user-name Robert`
5. Create access keys to the user: `account-iam iam create-access-keys --user-name Robert`
6. Create the alias for the user: `alias user-robert-s3=’AWS_ACCESS_KEY=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url <endpoint-url-s3>`

### No IAM User policy
7. User can create a bucket under the account: `user-robert-s3 s3 mb s3://bucket-robert`
8. User can put object in the bucket that the account root user created: `echo ‘test_data’ | user-robert-s3 cp - s3://bucket-account/test_object.txt`

### With IAM User Policy
9. Add user inline policy - so the IAM user cannot create a bucket, but can put an object.  
`admin-iam iam put-user-policy --user-name Robert --policy-name policy_deny_create_bucket_allow_put_object --policy-document file://policy_deny_create_bucket_allow_put_object.json`

`policy_deny_create_bucket_allow_put_object.json`

```json
{
    “Version”: “2012-10-17",
    “Statement”: [
        {
            “Effect”: “Deny”,
            “Action”: [
                “s3:CreateBucket”
            ],
            “Resource”: “*”
        },
        {
            “Effect”: “Allow”,
            “Action”: [
                “s3:PutObject”
            ],
            “Resource”: “*”
        }
    ]
}
```

10. User can put object in the account bucket: `echo ‘test_data’ | user-robert-s3 cp - s3://bucket-account/test_object2.txt` (should work)
11. User cannot create a bucket under the account: u`ser-robert-s3 s3 mb s3://bucket-robert-2` (should throw `AccessDenied` error)

### Notes:
The IAM policy (like bucket policy) is read from the account info, which is saved in the endpoint cache. Currently, the cache does not invalidate those changes immediately. For local testing, you may temporarily reduce the cache expiry in `src/sdk/object_sdk.js` by setting `expiry_ms: 1`, but this should never be committed to the repository.
