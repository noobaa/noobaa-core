# Non Containerized NSFS IAM (Developers Documentation)

## Related files:
1. [NC NSFS](../non_containerized_NSFS.md)
2. [NC NSFS Design Documentation](../design/NonContainerizedNooBaaDesign.md)
2. [IAM Design Documentation](../design/iam.md)

## Get Started
Currently, we do not validate the input, so the test should use only valid input.

1. Create the `FS_ROOT` and a directory for a bucket: `mkdir -p /tmp/nsfs_root1/my-bucket` and give permissions `chmod 777 /tmp/nsfs_root1/` `chmod 777 /tmp/nsfs_root1/my-bucket`.
This will be the argument for:
  - `new_buckets_path` flag  `/tmp/nsfs_root1` (that we will use in the account commands)
  - `path` in the buckets commands `/tmp/nsfs_root1/my-bucket` (that we will use in bucket commands).
2. Create the root user account with the CLI:
`sudo node src/cmd/manage_nsfs account add --name <name> --new_buckets_path /tmp/nsfs_root1 --access_key <access-key> --secret_key <secret-key> --uid <uid> --gid <gid>`.
3. Start the NSFS server (using debug mode and the port for IAM): `sudo node src/cmd/nsfs --debug 5 --https_port_iam 7005`
Note: before starting the server please add this line: `process.env.NOOBAA_LOG_LEVEL = 'nsfs';` in the endpoint.js (before the condition `if (process.env.NOOBAA_LOG_LEVEL) {`)
4. Create the alias for IAM service: 
`alias nc-user-1-iam='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`.
5. Use AWS CLI to send requests to the IAM service, for example:
 `nc-user-1-iam iam create-user --user-name Bob --path /division_abc/subdivision_xyz/`
 `nc-user-1-iam iam get-user --user-name Bob`
 `nc-user-1-iam iam update-user --user-name Bob --new-path /division_abc/subdivision_abc/`
 `nc-user-1-iam iam delete-user --user-name Bob`
 `nc-user-1-iam iam list-users`

 `nc-user-1-iam iam create-access-key --user-name Bob`
 `nc-user-1-iam iam update-access-key --access-key-id <access-key> --user-name Bob --status Inactive`
 `nc-user-1-iam iam delete-access-key --access-key-id <access-key> --user-name Bob`
 `nc-user-1-iam iam list-access-keys --user-name Bob`

Create the alias for IAM service for the user that was created (with its access keys):
`alias nc-user-1-iam-regular='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`.
`nc-user-1-iam-regular iam get-access-key-last-used --access-key-id <access-key>`

### Demo Examples:
#### Deactivate Access Key:
`alias nc-user-1-iam-regular='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:6443'` (port for s3)
1. Use the root account credentials to create a user: `nc-user-1-iam iam create-user --user-name <username>`
2. Use the root account credentials to create access keys for the user: `nc-user-1-iam iam create-access-key --user-name <username>`
3. The alias for s3 service: `alias nc-user-1-s3-regular='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:6443'` 
2. Create a bucket (so we can list it) `nc-user-1-s3-regular s3 mb s3://<bucket-name`
3. List bucket (use s3 service)`nc-user-1-s3-regular s3 ls`
4. List access keys (use IAM service) `nc-user-1-iam-regular iam list-access-keys`
5. Deactivate access keys: `nc-user-1-iam iam update-access-key --access-key-id <access-key> --user-name <username> --status Inactive`
6. It should throw an error for both s3 service (`nc-user-1-s3-regular s3 ls`) and iam service (`nc-user-1-iam-regular iam list-access-keys`) that uses the deactivated access key.
Note: Currently we clean the cache after update, but it happens for the specific endpoint, if there are more endpoints (using forks) developers can change the expiry cache in the line `expiry_ms: 1` inside `account_cache` (currently inside object_sdk).

#### Rename Username:
1. Use the root account credentials to create a user: `nc-user-1-iam iam create-user --user-name <username>` (You should see the config file in under the accounts directory).
2. Use the root account credentials to create access keys for the user:(first time): `nc-user-1-iam iam create-access-key --user-name <username>` (You should see the first symbolic link in under the access_keys directory).
3. Use the root account credentials to create access keys for the user (second time): `nc-user-1-iam iam create-access-key --user-name <username>` (You should see the second symbolic link in under the access_keys directory).
4. Update the username: `nc-user-1-iam iam update-user --user-name <username> --new-user-name <new-username>` (You should see the following changes: config file name updated, symlinks updated according to the current config).

#### Create root account using the IAM API (requesting account is root accounts manager):
1. Create the root accounts manager with the CLI:
`sudo node src/cmd/manage_nsfs account add --name <name> --new_buckets_path /tmp/nsfs_root1 --access_key <access-key> --secret_key <secret-key> --uid <uid> --gid <gid> --iam_operate_on_root_account`.
2. Use the root accounts manager details in the alias:
`alias nc-user-manager-iam='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`.
3. Use the root accounts manager account credentials to create a root account:
 `nc-user-manager-iam create-user --user-name <username>`
4. Use the root account credentials to create access keys for the root account: `nc-user-manager-iam iam create-access-key --user-name <username>`

#### One Account With 2 Users With Bucket Policy
Note: Currently we have implementation of the Principal field as name or ID in NC - not with ARN at this point, so we will use what we currently have in this example (we can support it in the future).

##### Basic steps (create account and bucket and check connection to endpoint)
1. Create an account with noobaa CLI: `sudo node src/cmd/manage_nsfs account add --name <account-name> --new_buckets_path /Users/buckets/ --access_key <access-key> --secret_key <secret-key> --uid <uid> --gid <gid>`
Note: before creating the account need to give permission to the `new_buckets_path`: `chmod 777 /Users/buckets/`.
2. Start the NSFS server (using debug mode and the port for IAM): `sudo node src/cmd/nsfs --debug 5 --https_port_iam 7005`
3. Create the alias for S3 service:`alias nc-user-1-s3=‘AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:6443’`.
4. Check the connection to the endpoint and try to list the buckets (should be empty): `nc-user-1-s3 s3 ls; echo $?`
5. Add bucket to the account using AWS CLI: `nc-user-1-s3 s3 mb s3://bucket-01` (`bucket-01` is the bucket name in this example) or noobaa CLI: `sudo node src/cmd/manage_nsfs bucket add --name bucket-01 --path /Users/buckets/bucket-01 --owner <account-name>`
6. Create the alias for IAM service: 
`alias nc-user-1-iam='AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`
7. Check the connection to the endpoint and try to list the users (should be empty): `nc-user-1-iam iam list-users`

##### IAM steps (create 3 users with access keys)
We will create 3 users:
(1) user for read-write permission user-rw
(2) user for read permission user-ro
(3) user without any permission user-no

We will give example of user-rw, but it is the same for the rest
8. Create user: `nc-user-1-iam iam create-user --user-name user-rw`
9. Create access key for user user-rw: `nc-user-1-iam iam create-access-key --user-name user-rw`
10. Create alias for S3 service:`alias nc-user-rw-s3=‘AWS_ACCESS_KEY_ID=<access-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:6443’`.
11. Check the connection to the endpoint and try to list the buckets (should be one): `nc-user-rw-s3 s3 ls; echo $?`

we will have 3 alias: `nc-user-rw-s3`, `nc-user-ro-s3`, `nc-user-no-s3`

##### S3 steps (bucket policy and s3 operations)
12. Root account will put the bucket policy - `nc-user-1-s3 s3api put-bucket-policy --bucket bucket-01 --policy file://policy.json`

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
13. user-rw can put object: `echo 'hello_world1' | nc-user-rw-s3 s3 cp - s3://bucket-01/hello_world1.txt #valid`
14. user-rw can get object: `nc-user-rw-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout`
15. user-rw can list the objects in the bucket: `nc-user-rw-s3 s3api list-objects-v2 --bucket bucket-01` (expected to see `hello_world1.txt`)

user user-ro:
16. user-ro cannot put object: `echo 'hello_world2' | nc-user-ro-s3 s3 cp - s3://bucket-01/hello_world2.txt #invalid` (`AccessDenied` error)
17. user-ro can get object: `nc-user-ro-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout`
18. user-ro can list the objects in the bucket: `nc-user-ro-s3 s3api list-objects-v2 --bucket bucket-01` (expected to see `hello_world1.txt`)

user user-no: (all should fail with `AccessDenied` error)
20. user-no cannot put object: `echo 'hello_world3' | nc-user-no-s3 s3 cp - s3://bucket-01/hello_world3.txt #invalid` (`AccessDenied` error)
21. user-no cannot get object: `nc-user-no-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout` (`AccessDenied` error)
22. user-no cannot list the objects in the bucket: `nc-user-no-s3 s3api list-objects-v2 --bucket bucket-01` (`AccessDenied` error)

##### Expend the example (additional account and a user inside it)
23. Add another account with noobaa CLI - see step 1 and create alias `nc-user-2-iam`
24. Add user `acc2-user` with access key and create alias `nc-user-acc2-user-s3` - see steps 8-10
25. Run the operations: 
user uacc2-user: (all should fail with `AccessDenied` error)
26. user-no cannot put object: `echo 'hello_world4' | nc-user-acc2-user-s3 s3 cp - s3://bucket-01/hello_world4.txt #invalid` (`AccessDenied` error)
27. user-no cannot get object: `nc-user-acc2-user-s3 s3api get-object --bucket bucket-01 --key hello_world1.txt /dev/stdout` (`AccessDenied` error)
28. user-no cannot list the objects in the bucket: `nc-user-acc2-user-s3 s3api list-objects-v2 --bucket bucket-01` (`AccessDenied` error)
