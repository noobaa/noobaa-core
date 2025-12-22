# Containerized NooBaa IAM

This document is about the IAM implementation in Containerized deplyment.  
More information about IAM implemenation in NC at - [NC IAM design](./../design/iam_nc.md).  

## Glossary
**Access keys** = a pair of access key ID (in short: access key) and secret access key (in short: secret key)  
**ARN** = Amazon Resource Name  
**IAM** =  Identity and Access Management  

## Goal
Ability to operate NooBaa accounts for Containerized NooBaa using IAM API ([AWS documentation](https://docs.aws.amazon.com/iam/)).  
A created user will be able to get access to NooBaa resources (buckets, objects).  

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
- Users: CreateUser, GetUser, UpdateUser, DeleteUser, ListUsers.  
- Access Keys: CreateAccessKey, GetAccessKeyLastUsed, UpdateAccessKey, DeleteAccessKey, ListAccessKeys.
- User Tags: TagUser, UntagUser, ListUserTags
- User Inline Policies: PutUserPolicy, DeleteUserPolicy, GetUserPolicy, ListUserPolicies
### Out of Scope
At this point, we will not support additional IAM resources (group, role, etc.) and managed user policies.

## Architecture
![IAM FLOW](https://github.com/user-attachments/assets/5ed886a5-6088-43cb-aec5-b802b4cd5546)


#### NooBaa Endpoint
- Extend `AccountSDK` and create new Account SDK `NBAccountSDK` and initiate it
- Enable IAM endpoint service by assigning valid port to `config.ENDPOINT_SSL_IAM_PORT`

#### Implements AccountSpace
- In NC IAM implementation [design doc](./iam_nc.md) already defined User and Access key APis, but for containerized deployment, we need to add APIs related to tagging and inline user policies

#### Design Flow
- The boilerplate code is based on STS and S3 services
- IAM service will be supported in Account service (which requires the endpoint)
- In the endpoint we created the `https_server_iam`
- The server would listen to a new port `https_port_iam`
  - It will be a separate port
- To create the server we created the `endpoint_request_handler_iam`
  - The `iam_rest` that either `handle_request` or `handle_error`
  - The `IamError` class.
  - The ops directory and each supported action will be a file with name iam_<action>
- We created the `AccountSDK` class and the `AccountSpace` interface:
  - The `AccountSpace` interface is defined in nb.d.ts
  - The initial IAM request is routed through `AccountSpaceNB` and subsequently redirected to the Accounts Server. 
  - The Accounts Server is responsible for handling all implementations related to users, access keys, user tags, and user inline policies. With this design, we will make sure all the DB-related actions are done in NooBaa core side.

- **Implicit policy** that we use:
  - User, Tag, Inline User Policy (Create, Get, Update, Delete, List) - only root account
  - AccessKey (Create, Update, Delete, List)
    - root account
    - all IAM users only for themselves (except the first creation that can be done only by the root account).

Note: We will extend the existing architecture changes, which were originally created for IAM NC, to support NooBaa containerized deployments. This involves leveraging the AccountSDK and implementing the AccountSpace interface.


### Root Accounts
- We will be using the existing NooBaa CLI to create the root accounts with an access key.
- IAM does not allow the creation of root accounts in this release
- Existing accounts, including the initial NooBaa admin account, those created via the Command Line Interface (CLI), and Object Bucket Claim (OBC) accounts, will continue to be classified as accounts.

```
    bash
    noobaa account create {account_name} --show-secrets
```

There will be two types of accounts
- Accounts: Existing accounts, including system-generated accounts (admin, operator, and support), as well as accounts created via OBC and CRD (CLI), will all remain as accounts.
  - OBC accounts won’t be able to create IAM users , return with error message AccessDeniedException
- IAM Users: Only accounts can create IAM users (except for OBC accounts).

## IAM Account DB Changes

- accounts schema Changes
```
owner: { objectid: true },
creation_date: { idate: true },
iam_path: { type: 'string' },
iam_user_policies: {
    type: 'array',
    items: {
        $ref: 'common_api#/definitions/iam_user_policy',
    }
},
tagging: {
    $ref: 'common_api#/definitions/tagging',
}
```
The accounts schema has been updated to include properties like `owner`, `iam_path`, `iam_user_policies`, `creation_date`, and `tagging`. The `owner` property is used internally by the code to identify if it is a root account or IAM user.

- owner: Reference to created root account
- iam_path: IAM path value
- iam_user_policies: Reference to iam_policies schema.
- tagging: Hold IAM tagging info, key-value pair


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



## IAM Policy Validation
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
req.object_sdk.requesting_account.iam_user_policies
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
- IAM ListRoles
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


#### Naming Scope
- Account names are unique between the accounts, for example, if we have account with name John, you cannot create a new account with the name John (and also cannot update the name of an existing account to John).
- Usernames are unique only inside the account, for example: username Robert can be under account-1, and another user with username Robert can be under account-2.
Note: The username cannot be the same as the account, for example: under account John we cannot create a username John (and also cannot update the name of an existing username to John). Note: The username cannot be the same as the account, for example: under account John we cannot create a username John (and also cannot update the name of an existing username to John).

Example: 2 accounts (alice and bob) both of them have user with username Robert (notice the different ID number).


In a containerized deployment, accounts are stored in the database.  
- To ensure a unique identifier (email address) for an IAM user, we can combine the lower-cased IAM username with the requested root account name, resulting in a format like  `${user_name_lowercase}:${root_account_id}`. Root accounts will maintain their existing behavior.  
- The design decision is to store the case-sensitive IAM username as the account name.  

The design decision is to store the case-sensitive IAM username as the account name. The email address will be made unique by combining the lower-cased username with the root account ID.

```
68e76266a90e65000d652f67 | {"_id": "{root_account_id}", "name": "IAM_user1", "email": "iam_user1:{root_account_id}", "owner": "68e75e5c702b4100216e24b6","iam_path": "/division_abc/subdivision_xyz/iam-first1", "has_login": false, "last_update": 1759994470793, "master_key_id": "{master_key_id}", "default_resource": "{default_resource_id}", "allow_bucket_creation": true}
```

## Other

#### Root Account / Account
- In NooBaa Containerized, the term "account" will be the equivalent term used for "root account".
  - The account is the owner of the users that it created using the IAM API. The account owns the users and manage them (can create, read, update, delete or list them).
  - The account is the owner of the buckets that were created by it or by its users.
- In AWS root accounts are only created in the console.  
While in NooBaa, accounts can be created by - 
  - NooBaa CLI `noobaa account create` command.

- In NooBaa, an account is identified by:  
  - Name  - in the CLI we pass the account name. The account name is unique within all the accounts (you cannot create a new account with the name of an existing account).
  - Access key - in S3 API and IAM API the request is signed with the requesting account credentials.

#### Identity
- In general, we manage identities - currently accounts and users - but in the future, we might support roles, groups, etc.

#### IAM User / User
- In NooBaa we decide to omit the "IAM" from the term "IAM users" as IAM is Identity & Access Management, and we thought it would be clear enough just the term "user" in our system.
- users are individual users within an account (for a single person or application), they aren't separate accounts. 
- users and their access keys have long-term credentials to the system resource, they give the ability to make programmatic requests to NooBaa service using the API or CLI.  
This was partially copied from [AWS IAM Guide - Intro](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_identity-management.html#intro-identity-users) and [AWS IAM Guide - When To Use IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/when-to-use-iam.html#security_iam_authentication-iamuser).
- In NooBaa, a user is identified by:
  - Name - in the IAM API we pass the `--user-name` flag. The username is unique only under the account (not including the account name itself).
  - Access key - in S3 API and IAM API the request is signed with the requesting user credentials.
- Currently, users cannot use any IAM API operations on other users.
