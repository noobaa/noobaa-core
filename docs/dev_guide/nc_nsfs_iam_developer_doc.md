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
`sudo node src/cmd/manage_nsfs account add --name <name>> --new_buckets_path /tmp/nsfs_root1 --access_key <access-key> --secret_key <secret-key> --uid <uid> --gid <gid>`.
2. Start the NSFS server (using debug mode and the port for IAM): `sudo node src/cmd/nsfs --debug 5 --https_port_iam 7005`
Note: before starting the server please add this line: `process.env.NOOBAA_LOG_LEVEL = 'nsfs';` in the endpoint.js (before the condition `if (process.env.NOOBAA_LOG_LEVEL) {`)
4. Create the alias for IAM service: 
`alias s3-nc-user-1-iam='AWS_ACCESS_KEY_ID=<acess-key> AWS_SECRET_ACCESS_KEY=<secret-key> aws --no-verify-ssl --endpoint-url https://localhost:7005'`.
11. Use AWS CLI to send requests to the IAM service, for example:
 `s3-nc-user-1-iam iam create-user --user-name Bob --path /division_abc/subdivision_xyz/`
 `s3-nc-user-1-iam iam get-user --user-name Bob`
 `s3-nc-user-1-iam iam update-user --user-name Bob --new-path /division_abc/subdivision_abc/`
 `s3-nc-user-1-iam iam delete-user --user-name Bob`
 `s3-nc-user-1-iam iam list-users`