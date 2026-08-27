# Containerized NooBaa IAM

This document is about the IAM implementation in Containerized deplyment.  
More information about IAM implemenation in NC at - [NC IAM design](./../design/iam_nc.md).  

## Glossary
**Access keys** = a pair of access key ID (in short: access key) and secret access key (in short: secret key)  
**ARN** = Amazon Resource Name  
**IAM** =  Identity and Access Management  

## Goal
Ability to operate NooBaa accounts for Containerized NooBaa using IAM API ([AWS documentation](https://docs.aws.amazon.com/iam/)).  
A created IAM user and IAM role will be able to get access to NooBaa resources (buckets, objects).

## Background
Currently, NooBaa account creation APIs are specific to NooBaa and do not adhere to industry standards.  
IAM APIs will provide industry standards, and that will enable customers to create wrappers around it, making use of existing scripts that already work for AWS IAM. Customers are trying to create a real multi-tenant environment, mainly for data scientists, but not only. And also providing the right access control for users.

## Problem
Limitation of current NooBaa account API
- Specific to NooBaa
- Significant  learning curve, needs to go through the NooBaa documentation
- Customer needs to create NooBaa specific script or wrapper.
- Do not provide account-level policies, eg: block listing of buckets.

## In Scope Scenarios
To provide minimal IAM support, we will focus on a select set of AWS IAM APIs for account and policy management, rather than implementing the full range of APIs available.

Support IAM API:
### Common IAM Identity Model
- Identities are stored in the same `accounts` collection with `identity_type` (`ACCOUNT` / `USER` / `ROLE`)
- IAM paths are stored in `iam_path`
- Inline policies are stored in `iam_inline_policies`

### IAM Users
- Users: CreateUser, GetUser, UpdateUser, DeleteUser, ListUsers
- Access Keys: CreateAccessKey, GetAccessKeyLastUsed, UpdateAccessKey, DeleteAccessKey, ListAccessKeys
- User Tags: TagUser, UntagUser, ListUserTags
- User Inline Policies: PutUserPolicy, DeleteUserPolicy, GetUserPolicy, ListUserPolicies

### IAM Roles
- Roles: CreateRole, GetRole, UpdateRole, DeleteRole, ListRoles, UpdateAssumeRolePolicy
- Role Inline Policies: PutRolePolicy, DeleteRolePolicy, GetRolePolicy, ListRolePolicies

### Out of Scope
At this point, we will not support additional IAM resources (group, etc.) and managed user policies.

## Architecture
![IAM FLOW](https://github.com/user-attachments/assets/5ed886a5-6088-43cb-aec5-b802b4cd5546)

#### NooBaa Endpoint
- Extend `AccountSDK` and create new Account SDK `NBAccountSDK` and initiate it
- Enable IAM endpoint service by assigning valid port to `config.ENDPOINT_SSL_IAM_PORT`

#### Design Flow
- The boilerplate code is based on STS and S3 services
- IAM service will be supported in Account service (which requires the endpoint)
- In the endpoint we created the `https_server_iam`
- The server would listen to a new port `https_port_iam`
  - It will be a separate port
- To create the server we created the `endpoint_request_handler_iam`
  - The `iam_rest` that either `handle_request` or `handle_error`
  - The `IamError` class.
  - The ops directory and each supported action will be a file with name `iam_<action>`
- We created the `AccountSDK` class and the `AccountSpace` interface:
  - The `AccountSpace` interface is defined in nb.d.ts
  - The initial IAM request is routed through `AccountSpaceNB` and subsequently redirected to the Accounts Server. 
  - The Accounts Server is responsible for handling all implementations related to users, roles, access keys, and IAM inline policies. With this design, we will make sure all the DB-related actions are done in NooBaa core side.
- **Implicit policy** that we use:
  - User, Tag, Inline User Policy (Create, Get, Update, Delete, List) - only root account
  - AccessKey (Create, Update, Delete, List)
    - root account
    - all IAM users only for themselves (except the first creation that can be done only by the root account).
  - Role, AssumeRolePolicy, Inline Role Policy (Create, Get, Update, Delete, List) - only root account

Note: We will extend the existing architecture changes, which were originally created for IAM NC, to support NooBaa containerized deployments. This involves leveraging the AccountSDK and implementing the AccountSpace interface.

### Root Accounts
- We will be using the existing NooBaa CLI to create the root accounts with an access key.
- IAM does not allow the creation of root accounts in this release
- Existing accounts, including the initial NooBaa admin account, those created via the Command Line Interface (CLI), and Object Bucket Claim (OBC) accounts, will continue to be classified as accounts.

```
    bash
    noobaa account create {account_name} --show-secrets
```

There are three identity types in the accounts collection
- Accounts: Existing accounts, including system-generated accounts (admin, operator, and support), as well as accounts created via OBC and CRD (CLI), will all remain as accounts.
  - OBC accounts won’t be able to create IAM users , return with error message AccessDeniedException
- IAM Users: Only accounts can create IAM users (except for OBC accounts).
- IAM Roles: Roles are also stored in accounts and are identified by `identity_type: 'ROLE'`.

## IAM Account DB Changes

### Accounts schema changes
In a containerized deployment, identities are stored in the `accounts` collection.
Common IAM identity fields:

```
owner: { objectid: true },
identity_type: { $ref: 'common_api#/definitions/identity_type' },
creation_date: { idate: true },
iam_path: { type: 'string' },
iam_inline_policies: {
    type: 'array',
    items: {
        $ref: 'common_api#/definitions/iam_inline_policy',
    }
},
description: { type: 'string' }, // role-only
max_session_duration: { type: 'integer' }, // role-only
assume_role_policy_document: { $ref: 'common_api#/definitions/iam_trust_policy_document' }, // role-only
tagging: {
    $ref: 'common_api#/definitions/tagging',
}
```

- owner: Reference to created root account
- iam_path: IAM path value
- iam_inline_policies: Reference to iam_policies schema
- tagging: Hold IAM tagging info, key-value pair

### Role-only schema fields
- description
- max_session_duration
- assume_role_policy_document

### Identity naming and uniqueness
- Account names are globally unique across accounts
- User names are unique under the owning account
- Role names are unique under the owning account
  - Role name uniqueness is case-insensitive, while stored/displayed role names preserve original case
- User internal email key format: `${user_name_lowercase}:${root_account_id}`
- Role internal email key format: `role/${role_name_lowercase}:${owner_account_id}`

And the account `access_keys` updated with two properties `deactivated` and `creation_date`.  

```
access_keys: {
    type: 'array',
    items: {
        type: 'object',
        required: ['access_key', 'secret_key'],
        properties: {
            access_key: { $ref: 'common_api#/definitions/access_key' },
            secret_key: { $ref: 'common_api#/definitions/secret_key' },
            deactivated: { type: 'boolean' },
            creation_date: { idate: true },
        }
    }
}
```

### DB Upgrade Script for 4.21
- Account Schema Changes: No mandatory fields are added to the account schema in this release.
- Bucket Policy Updates: All bucket policy principals must be updated to use the full account ARN instead of account name.
  - Accounts: ARN should `aws:arn:<account_id>:root`
  - IAM User: ARN should `aws:arn:<account_id>:user/<path>:Username`

## IAM Inline Policy Validation
- You can find the design doc [here](./IamUserInlinePolicy.md).  
- IAM user inline policies are checked for authorization only in S3 operations.  
- For detailed information, please see  [IAM User Inline Policy Doc](./IamUserInlinePolicy.md).  
- Initially, an IAM user has no S3 access without an IAM policy. Account owner needs to invoke the `PutUserPolicy` API, granting full/partial access. The account owner can later modify this IAM policy to apply more specific restrictions.

```
{ 	
  "Version": "2012-10-17",
  "Statement": [ {
  "Effect": "Allow", 
  "Action": [ "s3:*" ], 
  "Resource": "*"
  } ]
}
```

- In S3 request flow IAM policy validated before the bucket policy validation. Fetch IAM account policies from IAM accounts.

```
req.object_sdk.requesting_account.iam_inline_policies
```

- IAM policy is validated against the resource and actions.

### No Bucket Policy
If the resource doesn’t have a bucket policy the IAM user accounts can have access to the resources of the same root account.
For example: 
- root account creates 2 users (both are owned by it): user1, user2 and a bucket (bucket owner: `<root-account-id>`, bucket creator: `<account-id-user1>`).
- user1 upload a file to the bucket 
- user2 can delete this bucket (after it is empty): although user2 is not the creator, without a bucket policy his root account is the owner so it can delete the bucket.

### Root Accounts Manager
The root accounts cannot be created using the IAM APIs in containerized deployment.

## Supported Actions and their Request Parameters
### Supported IAM User Operations
- IAM CreateUser: Path, UserName (not supported: PermissionsBoundary, Tags.member.N)
- IAM GetUser: UserName
- IAM UpdateUser: NewPath, NewUserName, UserName
- IAM DeleteUser: UserName
- IAM ListUsers: PathPrefix (not supported: Marker, MaxItems)

### Supported IAM Access Keys Operations
- IAM CreateAccessKey: UserName
- IAM GetAccessKeyLastUsed: AccessKeyId
- IAM UpdateAccessKey: AccessKeyId, Status, UserName
- IAM DeleteAccessKey: AccessKeyId, UserName
- IAM ListAccessKeys: UserName (not supported: Marker, MaxItems)

### Supported IAM User Tag Operations
- IAM TagUser: UserName, Tags.member.N
- IAM UntagUser: UserName, TagKeys.member.N
- IAM ListUserTags: UserName (not supported: Marker, MaxItems)

### Supported IAM User Inline Policy Operations
- PutUserPolicy:  UserName, PolicyDocument, PolicyName
- DeleteUserPolicy: UserName, PolicyName
- GetUserPolicy: UserName, PolicyName
- ListUserPolicies: UserName (not supported: Marker, MaxItems)

### Supported IAM Role Operations
- CreateRole: RoleName, AssumeRolePolicyDocument, Path, Description, MaxSessionDuration
- GetRole: RoleName
- UpdateRole: RoleName, Description, MaxSessionDuration
- DeleteRole: RoleName
- ListRoles: PathPrefix (not supported: Marker, MaxItems)
- UpdateAssumeRolePolicy: RoleName, PolicyDocument

### Supported IAM Role Inline Policy Operations
- PutRolePolicy: RoleName, PolicyDocument, PolicyName
- DeleteRolePolicy: RoleName, PolicyName
- GetRolePolicy: RoleName, PolicyName
- ListRolePolicies: RoleName (not supported: Marker, MaxItems)

### Other
Would always return an empty list (to check that the user exists it runs GetUser)
- IAM ListGroupsForUser
- IAM ListAttachedUserPolicies
- IAM ListMFADevices
- IAM ListServiceSpecificCredentials
- IAM ListSigningCertificates
- IAM ListSSHPublicKeys
Would always return an empty list
- IAM ListAccountAliases
- IAM ListAttachedGroupPolicies
- IAM ListAttachedRolePolicies
- IAM ListGroupPolicies
- IAM ListGroups
- IAM ListInstanceProfiles
- IAM ListOpenIDConnectProviders
- IAM ListPolicies
- IAM ListSAMLProviders
- IAM ListServerCertificates
- IAM ListVirtualMFADevices
Would always return `NoSuchEntity` error
- IAM ListEntitiesForPolicy
- IAM ListInstanceProfilesForRole
- IAM ListInstanceProfileTags
- IAM ListMFADeviceTags
- IAM ListOpenIDConnectProviderTags
- IAM ListPolicyTags
- IAM ListPolicyVersions
- IAM ListRoleTags
- IAM ListServerCertificateTags

## Identity Terminology

#### Root Account / Account
- In NooBaa Containerized, the term "account" will be the equivalent term used for "root account".
  - The account is the owner of the users that it created using the IAM API. The account owns the users and manage them (can create, read, update, delete or list them).
  - The account is the owner of the roles that it created using the IAM API.
  - The account is the owner of the buckets that were created by it or by its users.
- In AWS root accounts are only created in the console.  
While in NooBaa, accounts can be created by - 
  - NooBaa CLI `noobaa account create` command.
- In NooBaa, an account is identified by:  
  - Name  - in the CLI we pass the account name. The account name is unique within all the accounts (you cannot create a new account with the name of an existing account).
  - Access key - in S3 API and IAM API the request is signed with the requesting account credentials.

#### IAM User / User
- In NooBaa we decide to omit the "IAM" from the term "IAM users" as IAM is Identity & Access Management, and we thought it would be clear enough just the term "user" in our system.
- users are individual users within an account (for a single person or application), they aren't separate accounts. 
- users and their access keys have long-term credentials to the system resource, they give the ability to make programmatic requests to NooBaa service using the API or CLI.  
This was partially copied from [AWS IAM Guide - Intro](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_identity-management.html#intro-identity-users) and [AWS IAM Guide - When To Use IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/when-to-use-iam.html#security_iam_authentication-iamuser).
- In NooBaa, a user is identified by:
  - Name - in the IAM API we pass the `--user-name` flag. The username is unique only under the account (not including the account name itself).
  - Access key - in S3 API and IAM API the request is signed with the requesting user credentials.
- Currently, users cannot use any IAM API operations on other users.

#### IAM Role / Role
- In NooBaa, a role is an identity managed in the same accounts collection with `identity_type: 'ROLE'`.
- A role is identified by:
  - Name - in the IAM API we pass the `--role-name` flag. The role name is unique per owner account.
  - ARN - in IAM and STS flows the role is referenced as `arn:aws:iam::<owner_account_id>:role/<path><role_name>` (`path` comes from `iam_path`).
- Role trust policy is stored in `assume_role_policy_document`.
- Role inline policies are stored in `iam_inline_policies`.

## Naming Scope
- Account identity (`identity_type: 'ACCOUNT'`):
  - Account names are globally unique across all accounts.
  - Accounts are identified by account name (CLI/admin flows) and access key (signed S3/IAM flows).
- User identity (`identity_type: 'USER'`):
  - User names are unique only under the owning account.
  - Internal key format is `${user_name_lowercase}:${root_account_id}` for uniqueness and lookup.
- Role identity (`identity_type: 'ROLE'`):
  - Role names are unique per owner account (AWS-compatible behavior).
  - Role name uniqueness is case-insensitive per owner, while response values preserve original case.
  - Internal key format is `role/${role_name_lowercase}:${owner_account_id}`.

