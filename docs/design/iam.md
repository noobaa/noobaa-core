# IAM

## Glossary
**Access keys** = a pair of access key ID (in short: access key) and secret access key (in short: secret key)  
**ARN** = Amazon Resource Name  
**CRUD** = Create, Read, Update, Delete  
**IAM** =  Identity and Access Management  
**NC** = Non-Containerized  
**NSFS** = Namespace Store File System  


## Goal
Ability to operate NooBaa accounts for NC NSFS using IAM API ([AWS documentation](https://docs.aws.amazon.com/iam/)).  
A created user will be able to get access to NooBaa resources (buckets, objects).

## Background
- Currently, we create NC NSFS accounts using the Manage NSFS, which is a CLI command with root (privileged) permissions:
    ```bash
    sudo node src/cmd/manage_nsfs account add [flags]
    ```
- The NS NSFS account is saved as a JSON file with root permissions (under the default path: `/etc/noobaa.conf.d/accounts/<name>.json`).
- The structure of a valid account is determined by schema and validated using avj.  
There are a couple of required properties specific to NSFS: `nsfs_account_config` that include a UID and GID or a Distinguished Name.
- When an account is created the json reply contains all the details of the created account (as they are stored in the JSON file).

## Problem
As mentioned, for NooBaa NC NSFS deployments, the only way to create and update accounts is via the CLI.   
For certain deployments exposing the CLI is not a viable option (for security reasons, some organizations disable the SSH to a machine with root permissions).

## Scenarios
### In Scope
Support IAM API:  
- CreateUser, GetUser, UpdateUser, DeleteUser, ListUsers.  
- CreateAccessKey, GetAccessKeyLastUsed, UpdateAccessKey, DeleteAccessKey, ListAccessKeys.
### Out of Scope
At this point we will not support additional IAM resources (group, policy, role, etc).

## Architecture
![IAM FLOW](./images/IamCreateUserSd.png)

- The boilerplate code is based on STS and S3 services  
- IAM service will be supported in NSFS service (which requires the endpoint)
- In the endpoint we created the `https_server_iam`
- The server would listen to a new port `https_port_iam`
  - It will be a separate port  
  - During development phase will default to -1 to avoid listening to the port
- To create the server we created the `endpoint_request_handler_iam`.
  - The `iam_rest` that either `handle_request` or `handle_error`
  - The `IamError` class.
  - The the ops directory and each supported action will be a file with name `iam_<action>`
- We created the `AccountSDK` class and the `AccountSpace` interface:
  - The `AccountSpace` interface is defined in `nb.d.ts`
  - The initial (current) implementation is only `AccountSpaceFS`
  - `AccountSpaceFS` will contain all our implementations related to users and access keys - like we have for other resources: `NamespaceFS` for objects, `BucketSpaceFS` for buckets, etc

