# Non Containerized NSFS IAM (Developers Documentation)

## Related files:
1. [NooBaa Non Containerized README](../NooBaaNonContainerized/README.md)
2. [IAM Design Documentation](../design/iam.md)

## Get Started

### Basic Steps (Create an Account, a Bucket, and Check Connection to Endpoint)
1. Create an account with noobaa CLI:  
`sudo node src/cmd/manage_nsfs account add --name <account-name> --new_buckets_path /Users/buckets/ --access_key <access-key> --secret_key <secret-key> --uid <uid> --gid <gid>`  
Note: before creating the account need to give permission to the `new_buckets_path`: `chmod 777 /Users/buckets/`
2. Start the NSFS server (using debug mode and the port for IAM):  
`sudo node src/cmd/nsfs --debug 5 --https_port_iam 7005`
3. Create the alias for S3 service:  
`alias nc-user-1-s3=‘AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:6443’`
4. Check the connection to the endpoint and try to list the buckets (should be empty):  
`nc-user-1-s3 s3 ls; echo $?`
5. Add bucket to the account using AWS CLI:  
`nc-user-1-s3 s3 mb s3://bucket-01`  
(`bucket-01` is the bucket name in this example)  
or noobaa CLI:  
`sudo node src/cmd/manage_nsfs bucket add --name bucket-01 --path /Users/buckets/bucket-01 --owner <account-name>`
6. Create the alias for IAM service:  
`alias nc-user-1-iam='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`
7. Check the connection to the endpoint and try to list the users (should be empty):  
`nc-user-1-iam iam list-user`

### Call The IAM Actions
Use AWS CLI to send requests to the IAM service, for example:
#### IAM Users API  
 `nc-user-1-iam iam create-user --user-name Bob --path /division_abc/subdivision_xyz/`  

 `nc-user-1-iam iam get-user --user-name Bob`  

 `nc-user-1-iam iam update-user --user-name Bob --new-path /division_abc/subdivision_abc/`  

 `nc-user-1-iam iam delete-user --user-name Bob`  

 `nc-user-1-iam iam list-users`  

#### IAM Access Keys API  
 `nc-user-1-iam iam create-access-key --user-name Bob`  

 `nc-user-1-iam iam update-access-key --access-key-id <access-key> --user-name Bob --status Inactive`  

 `nc-user-1-iam iam delete-access-key --access-key-id <access-key> --user-name Bob`  

 `nc-user-1-iam iam list-access-keys --user-name Bob`

Create the alias for IAM service for the user that was created (with its access keys):  
`alias nc-user-1-iam-regular='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`  

`nc-user-1-iam-regular iam get-access-key-last-used --access-key-id <access-key>`

### Demo Examples:
#### Deactivate Access Key:
We will start with the steps in the part [Basic Steps](#get-started).

1. Use the root account credentials to create a user: `nc-user-1-iam iam create-user --user-name <username>`
2. Use the root account credentials to create access keys for the user: `nc-user-1-iam iam create-access-key --user-name <username>`
3. The alias for s3 service: `alias nc-user-1-s3-regular='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:6443'` 
2. Create a bucket (so we can list it) `nc-user-1-s3-regular s3 mb s3://<bucket-name`
3. List bucket (use s3 service)`nc-user-1-s3-regular s3 ls`
4. List access keys (use IAM service) `nc-user-1-iam-regular iam list-access-keys`
5. Deactivate access keys: `nc-user-1-iam iam update-access-key --access-key-id <access-key> --user-name <username> --status Inactive`
6. It should throw an error for both S3 service (`nc-user-1-s3-regular s3 ls`) and IAM service (`nc-user-1-iam-regular iam list-access-keys`) that uses the deactivated access key.

#### Rename Username:
We will start with the steps in the part [Basic Steps](#get-started).

1. Use the root account credentials to create a user: `nc-user-1-iam iam create-user --user-name <username>` (You should see the config file in under the accounts directory).
2. Use the root account credentials to create access keys for the user:(first time): `nc-user-1-iam iam create-access-key --user-name <username>` (You should see the first symbolic link in under the access_keys directory).
3. Use the root account credentials to create access keys for the user (second time): `nc-user-1-iam iam create-access-key --user-name <username>` (You should see the second symbolic link in under the access_keys directory).
4. Update the username: `nc-user-1-iam iam update-user --user-name <username> --new-user-name <new-username>` (You should see the following changes: config file name updated, symlinks updated according to the current config).

#### Create Root Account Using the IAM API (Requesting Account is Root Accounts Manager):
1. Create the root accounts manager with the CLI:
`sudo node src/cmd/manage_nsfs account add --name <name> --new_buckets_path /tmp/nsfs_root1 --access_key <access-key> --secret_key <secret-key> --uid <uid> --gid <gid> --iam_operate_on_root_account`.
2. Use the root accounts manager details in the alias:
`alias nc-user-manager-iam='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`.
3. Use the root accounts manager account credentials to create a root account:
 `nc-user-manager-iam create-user --user-name <username>`
4. Use the root account credentials to create access keys for the root account: `nc-user-manager-iam iam create-access-key --user-name <username>`

#### One Account With 2 Users With Bucket Policy
Note: Currently, we have implementation of the Principal field as name or ID in NC ([S3 Ops, Bucket Policy - Principal Field](../NooBaaNonContainerized//S3Ops.md#principal-field)) - not with ARN at this point, so we will use what we have at this example (we can support it in the future). 
We will start with the steps in the part [Basic Steps](#get-started).

##### IAM Steps (Create 3 Users With Access Keys)
We will create 3 users:
(1) user for read-write permission user-rw
(2) user for read permission user-ro
(3) user without any permission user-no

We will give example of user-rw, but it is the same for the rest
1. Create user: `nc-user-1-iam iam create-user --user-name user-rw`
2. Create access key for user user-rw: `nc-user-1-iam iam create-access-key --user-name user-rw`
3. Create alias for S3 service:`alias nc-user-rw-s3=‘AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:6443’`.
4. Check the connection to the endpoint and try to list the buckets (should be one): `nc-user-rw-s3 s3 ls; echo $?`

we will have 3 alias: `nc-user-rw-s3`, `nc-user-ro-s3`, `nc-user-no-s3`

##### S3 Steps (Bucket Policy and S3 Operations)
5. Root account will put the bucket policy - `nc-user-1-s3 s3api put-bucket-policy --bucket bucket-01 --policy file://policy.json`

policy with IDs (can be done in master branch)

```json
{
  "Version": "2012-10-17",
  "Statement": [ 
    { 
     "Sid": "AllowUserRW",
     "Effect": "Allow", 
     "Principal": { "AWS": [ "<id of user-rw>" ] }, 
     "Action": [ "s3:PutObject", "s3:GetObject", "s3:ListBucket" ], 
     "Resource": [ "arn:aws:s3:::bucket-01/*", "arn:aws:s3:::bucket-01" ] 
    },
    { 
      "Sid": "AllowUserRO",
      "Effect": "Allow", 
      "Principal": { "AWS": [ "id of user-ro" ] }, 
      "Action": [ "s3:GetObject", "s3:ListBucket"], 
      "Resource": [ "arn:aws:s3:::bucket-01/*", "arn:aws:s3:::bucket-01" ] 
     }
  ]
}
```

policy with names (can be done in version 5.17)

```
{
    "Version": "2012-10-17",
    "Statement": [ 
      { 
       "Sid": "AllowUserRW",
       "Effect": "Allow", 
       "Principal": { "AWS": [ "user-rw" ] }, 
       "Action": [ "s3:PutObject", "s3:GetObject", "s3:ListBucket" ], 
       "Resource": [ "arn:aws:s3:::bucket-01/*", "arn:aws:s3:::bucket-01" ] 
      },
      { 
        "Sid": "AllowUserRO",
        "Effect": "Allow", 
        "Principal": { "AWS": [ "user-ro" ] }, 
        "Action": [ "s3:GetObject", "s3:ListBucket"], 
        "Resource": [ "arn:aws:s3:::bucket-01/*", "arn:aws:s3:::bucket-01" ] 
       }
    ]
  }
```

user user-rw:
6. user-rw can put object: `echo 'hello_world1' | nc-user-rw-s3 s3 cp - s3://bucket-01/hello_world1.txt #valid`
7. user-rw can get object: `nc-user-rw-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout`
8. user-rw can list the objects in the bucket: `nc-user-rw-s3 s3api list-objects-v2 --bucket bucket-01` (expected to see `hello_world1.txt`)

user user-ro:
9. user-ro cannot put object: `echo 'hello_world2' | nc-user-ro-s3 s3 cp - s3://bucket-01/hello_world2.txt #invalid` (`AccessDenied` error)
10. user-ro can get object: `nc-user-ro-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout`
11. user-ro can list the objects in the bucket: `nc-user-ro-s3 s3api list-objects-v2 --bucket bucket-01` (expected to see `hello_world1.txt`)

user user-no: (all should fail with `AccessDenied` error)
12. user-no cannot put object: `echo 'hello_world3' | nc-user-no-s3 s3 cp - s3://bucket-01/hello_world3.txt #invalid` (`AccessDenied` error)
13. user-no cannot get object: `nc-user-no-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout` (`AccessDenied` error)
14. user-no cannot list the objects in the bucket: `nc-user-no-s3 s3api list-objects-v2 --bucket bucket-01` (`AccessDenied` error)

##### Expand The Example (Additional Account and a User Inside It)
15. Add another account with noobaa CLI - see step 1 and in [Basic Steps](#get-started) and create alias `nc-user-2-iam`
16. Add user `acc2-user` with access key and create alias `nc-user-acc2-user-s3` - see steps 1-3
17. Run the operations with user acc2-user: (all should fail with `AccessDenied` error)
18. user-no cannot put object: `echo 'hello_world4' | nc-user-acc2-user-s3 s3 cp - s3://bucket-01/hello_world4.txt #invalid` (`AccessDenied` error)
19. user-no cannot get object: `nc-user-acc2-user-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout` (`AccessDenied` error)
20. user-no cannot list the objects in the bucket: `nc-user-acc2-user-s3 s3api list-objects-v2 --bucket bucket-01` (`AccessDenied` error)
