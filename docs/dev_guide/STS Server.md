# NooBaa STS Service
## Security Token Service

---


# NooBaa STS (Security Token Service)

## Table of Contents
- [Overview](#overview)
- [Scope](#scope)
- [Feature Technical Details](#feature-technical-details)
- [Troubleshooting](#troubleshooting)
- [Documentation Links](#documentation-links)
- [Demo](#demo)
- [Q&A](#qa)

---

## Overview

### What is STS?

STS (Security Token Service) is a service that provides **temporary, limited-privilege credentials** for NooBaa/MCG (Multicloud Object Gateway) users. It is modeled after the [AWS Security Token Service](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html).

Instead of sharing long-lived access keys, an account owner can configure a **role** that other accounts can temporarily assume. The assuming account receives short-lived credentials that grant the permissions of the role account for a limited time window. 

---

## Overview

### Feature use cases

- **Delegated access**: Grant users access to buckets they don't normally have permission to reach, without sharing permanent credentials.
- **Temporary access**: Credentials expire automatically (default 1 hour, configurable 15 min - 12 hours), reducing risk from credential leakage.
- **CI/CD and automation**: Issue short-lived credentials to pipelines or automated processes that need bucket access for a limited task.
- **AWS compatibility**: S3 clients that already support STS (e.g., the AWS CLI, AWS SDKs) can use the same workflow against NooBaa.

---

## Scope

**In scope:**
- Role management - assign/remove role via NooBaa CLI.
- NooBaa STS endpoint/Service/Route supporting `AssumeRole` operation (with NooBaa being the identity provider).
- S3 functionality when a user assumes a role (temporary credentials).

**Out of scope:**
- Role management via the IAM endpoint itself (only via CLI).
- Integration with external Identity Providers (LDAP) - POC.

---

## Technical Details
- [STS Server](#sts-server)
- [Role configuration](#role-configuration)
- [Kubernetes Resources](#kubernetes-resources)
- [Role Management](#role-management)
- [Assume Role Operation](#assume-role-operation)
---

## Technical Details

### STS Server

STS server runs inside the **noobaa-endpoint** pods - the same pods that serve S3 and IAM. Each protocol listens on a different port:

| Protocol | HTTP Port | HTTPS Port | Purpose |
|----------|-----------|------------|---------|
| S3 | 6001 | 6443 | Object storage API |
| STS | -- | 7443 | Security Token Service |
| IAM | -- | 13443 | Identity and Access Management |

---

### Role configuration
#### What is a Role in NooBaa?

A role in NooBaa is a configuration (`role_config`) attached to an **account** that defines:
- **`role_name`**: A human-readable name for the role.
- **`assume_role_policy`**: A policy that specifies which accounts are allowed to assume this role and under what conditions.

Unlike AWS where roles are standalone entities, in NooBaa a role is a property of an account. When another user assumes this role, they gain the permissions of that account for the duration of the session.

---
### Role in NooBaa DB

Roles are **not stored in a separate table**. Instead, `role_config` is an embedded field within each **account entity**.

**Account schema** (`src/server/system_services/schemas/account_schema.js`):
```javascript
role_config: {
    $ref: 'common_api#/definitions/role_config'
}
```

---

### Role in NooBaa DB

**`role_config` definition** (`src/api/common_api.js`):
```javascript
role_config: {
    type: 'object',
    required: ['role_name', 'assume_role_policy'],
    properties: {
        role_name: { type: 'string' },
        assume_role_policy: { $ref: '#/definitions/assume_role_policy' }
    }
}
```

---

### Role in NooBaa DB

**`assume_role_policy` definition** (`src/api/common_api.js`):
```javascript
assume_role_policy: {
    type: 'object',
    required: ['statement'],
    properties: {
        version: { type: 'string' },
        statement: {
            type: 'array',
            items: {
                type: 'object',
                required: ['effect', 'action', 'principal'],
                properties: {
                    effect: { enum: ['allow', 'deny'], type: 'string' },
                    action: { type: 'array', items: { type: 'string' } },
                    principal: { type: 'array', items: { $ref: '#/definitions/email' } }
                }
            }
        }
    }
}
```

---
### Role in NooBaa DB

**Example role_config stored on an account:**
```json
{
  "role_name": "AllowDevOpsAccess",
  "assume_role_policy": {
    "version": "2012-10-17",
    "statement": [
      {
        "effect": "allow",
        "action": ["sts:AssumeRole"],
        "principal": ["devops@example.com", "ci-bot@example.com"]
      }
    ]
  }
}
```

---
### Role ARN format

When assuming a role, the caller must provide ARN that should be of the following format - 

```
arn:aws:sts::<access-key-of-role-account>:role/<role_name>
```
---

### Kubernetes resources

- **Service**: `sts` (LoadBalancer, port 443 -> targetPort 7443)
- **Route** (OpenShift): `sts` route with TLS reencrypt termination
- **TLS Certificate**: `noobaa-sts-serving-cert` secret, auto-generated by OpenShift serving cert annotation
- **Pod**: `noobaa-endpoint` deployment, which also serves S3 and IAM

---

### Role Management

Role management is done via the **NooBaa CLI**.
Roles can be assigned to or removed from an existing account. Account can be created as well by NooBaa CLI/CR.

#### CLI Commands

**Assign a role to an `existing account`:**

```bash
noobaa sts assign-role --email <account-email> \
  --role_config '{"role_name":"MyRole","assume_role_policy":{"version":"2012-10-17","statement":[{"effect":"allow","action":["sts:AssumeRole"],"principal":["assumer@example.com"]}]}}'
```

**Remove a role:**
```bash
noobaa sts remove-role --email <account-email>
```
---

#### Assume Role Operation

- Request Parameters: Role ARN, session Name, duration seconds.
- Response: temporary credentials and a session token. 

Next, the user will call S3 request while specifying the **temporary access keys and the session token**. When the session token expired, NooBaa will throw expired token error.

**Note -** 
- Default session duration - 1 hour.
- Min session duration - 15 minutes.
- Max session duration - 12 hours.

[AWS Assume Role API](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)

---

## Troubleshooting
- [Common STS Error Codes](#common-sts-error-codes)
- [Enable Debug Logging](#enable-debug-logging)
- [Key debug Log Patterns](#key-debug-log-patterns-to-search-for)
- [Endpoint Pod Logs Search](#enable-debug-logging)
- [STS Service and Route Status Check](#sts-service-and-route-status-check)
- [Inspect Account and Role Configuration](#inspect-account-and-role-configuration)
- [Common Issues and Solutions](#common-issues-and-solutions)
---

## Troubleshooting

### Common STS Error Codes

| Error Code | HTTP Code | Meaning | Common Cause |
|-----------|-----------|---------|--------------|
| `AccessDeniedException` | 400 | Not authorized | Wrong credentials, invalid signature, principal not in assume_role_policy |
| `ExpiredToken` | 400 | Session token expired | Token TTL passed; client needs to call AssumeRole again |

---

## Troubleshooting

### Common STS Error Codes

| Error Code | HTTP Code | Meaning | Common Cause |
|-----------|-----------|---------|--------------|
| `InvalidClientTokenId` | 403 | Bad access key or token | Access key not found, invalid JWT signature |
| `InvalidParameterValue` | 400 | Bad parameter | Invalid duration value |
| `ValidationError` | 400 | Input constraint failure | Duration out of range (< 900s or > 43200s) |

---

### Troubleshooting

#### Enable Debug Logging

1. Set the debug level on the endpoint pods:

```bash
kubectl edit cm -n openshift-storage noobaa-config
```

```yaml
apiVersion: v1
data:
  NOOBAA_LOG_LEVEL: all  # Changed from default_level
kind: ConfigMap
...
```

```
kubectl set env deployment/noobaa-endpoint NOOBAA_LOG_LEVEL=debug -n <your-noobaa-namespace>
```
---

#### Key debug log patterns to search for in noobaa endpoint pods logs - 
- `STS REQUEST` - Logged for every STS request with method, URL, and op name.
- `STS ERROR` - Logged for every STS error with full details.
- `sts_sdk.get_assumed_role` - Logged when resolving a role ARN.
- `authorize_request_policy` - Logged with the permission result (ALLOW/DENY/IMPLICIT_DENY).
- `assume_role_policy: statement` - Logs each policy statement being evaluated.
- `assume_role_policy: principal fit?` - Logs each principle being evaluated.
- `assume_role_policy: action fit?` - Logs each action being evaluated.
- `assume_role_policy: is_statements_fit` - Logs action and principle policy statement evaluation result.
- `JWT VERIFY FAILED` - Logged when session token verification fails.

--- 
#### Endpoint Pod Logs Search

```bash
# Filter for STS-related messages only
kubectl logs -l noobaa-s3=noobaa -n <namespace> --tail=500 | grep -iE "sts|assume_role|session_token" | less -R

# Filter for STS errors specifically
kubectl logs -l noobaa-s3=noobaa -n <namespace> --tail=500 | grep -i "STS ERROR" | less -R

# Filter for JWT/token issues
kubectl logs -l noobaa-s3=noobaa -n <namespace> --tail=500 | grep -iE "JWT VERIFY|TokenExpired|ExpiredToken|InvalidClientTokenId" | less -R

# Check logs from a specific endpoint pod
kubectl logs <ENDPOINT_POD> -n <namespace> --tail=200 -f | less -R
```

---

#### STS Service and Route Status Check

```bash
# Verify STS service and route (Openshift) exists and has endpoints
kubectl get svc sts -n <namespace>
oc get route sts -n <namespace>

# Get the STS endpoint URL from noobaa status
# Look for the "#- STS Addresses -#" section in the output
noobaa status -n <namespace>
```

---

#### Inspect Account and Role Configuration

```bash
# List all NooBaa accounts
noobaa account list -n <namespace>

# Check a specific account's status 
noobaa account status <account-name> -n <namespace>
```
---
#### Inspect Account and Role Configuration

```bash
# Check in the db the role config of the account
oc rsh noobaa-db-pg-cluster-1
sh-5.1$ psql nbcore
nbcore=# select * from accounts;
...
 <id> | {"_id": "<id>", "name": "assumed.user", "email": "assumed.user", "has_login": false, "access_keys": [{"access_key": "<access_key>", "secret_key": "<secret_key>"}], "last_update": 1776159926518, "role_config": {"role_name": "DemoRole", "assu
me_role_policy": {"version": "2012-10-17", "statement": [{"action": ["sts:AssumeRole"], "effect": "allow", "principal": ["assumer.user"]}]}}, "master_key_id": "<master_key_id>", "default_resource": "<resource_id>", "allow_bucket_creation": true}
```

---
#### Decode and Inspect a Session Token

If you have a session token (JWT) and want to inspect its contents:

```bash
# Decode the JWT payload (middle section) without verification
echo "<session-token>" | cut -d '.' -f 2 | base64 -d 2>/dev/null | jq .

# Expected output structure:
# {
#   "access_key": "<temp-access-key>",
#   "secret_key": "<temp-secret-key>",
#   "assumed_role_access_key": "<role-account-access-key>",
#   "iat": 1700000000,
#   "exp": 1700003600
# }

# Check if the token is expired
echo "<session-token>" | cut -d '.' -f 2 | base64 -d 2>/dev/null | jq '.exp | todate'
```
---

### Common Issues and Solutions
- [Issue: `ExpiredToken` Error when using temporary credentials](#issue-expiredtoken-when-using-temporary-credentials)
- [Issue: `AccessDeniedException` when calling AssumeRole](#issue-accessdeniedexception-when-calling-assumerole)
- [Issue: `InvalidClientTokenId` on S3 requests with session token](#issue-invalidclienttokenid-on-s3-requests-with-session-token)
- [Issue: Role not found (`NO_SUCH_ROLE`)](#issue-role-not-found-no_such_role)
- [Issue: STS endpoint not reachable](#issue-sts-endpoint-not-reachable)
---

### Common Issues and Solutions

##### Issue: `ExpiredToken` when using temporary credentials

**Cause:** The session token JWT has expired.

**Debug and solution:**
```bash
# Decode the token to check its expiration time
echo "<session-token>" | cut -d '.' -f 2 | base64 -d 2>/dev/null | jq '{exp: .exp, exp_human: (.exp | todate), now: now, expired: (.exp < now)}'

# Re-issue credentials with AssumeRole
AWS_ACCESS_KEY_ID=<assumer-access-key> \
AWS_SECRET_ACCESS_KEY=<assumer-secret-key> \
aws --endpoint-url https://${STS_ENDPOINT} --no-verify-ssl \
  sts assume-role \
  --role-arn "arn:aws:sts::<role-access-key>:role/<role-name>" \
  --role-session-name "new-session"

# To request a longer-lived token (up to 12 hours = 43200 seconds)
AWS_ACCESS_KEY_ID=<assumer-access-key> \
AWS_SECRET_ACCESS_KEY=<assumer-secret-key> \
aws --endpoint-url https://${STS_ENDPOINT} --no-verify-ssl \
  sts assume-role \
  --role-arn "arn:aws:sts::<role-access-key>:role/<role-name>" \
  --role-session-name "long-session" \
  --duration-seconds 43200
```

---
##### Issue: AccessDeniedException when calling AssumeRole

**Possible causes and debug steps:**

1. **Assumer not in principal list**: The requesting account's email is not listed in the role's `assume_role_policy.statement[].principal` array.
   ```bash
    # Look for "role_config" on the target account - verify the assumer's email is in the principal list
    oc rsh noobaa-db-pg-cluster-1
    sh-5.1$ psql nbcore
    nbcore=# select * from accounts;
   ```

2. **Wrong RoleArn format**: The ARN must be `arn:aws:sts::<access-key>:role/<role-name>`.
   ```bash
   # Get the access key of the role account andn Use the access_key from the output in the ARN
   noobaa account status <role-account-name> -n <namespace>

   # Construct and verify the ARN
   ROLE_ACCESS_KEY="<access-key-from-output>"
   ROLE_NAME="<role-name-from-role_config>"
   echo "RoleArn: arn:aws:sts::${ROLE_ACCESS_KEY}:role/${ROLE_NAME}"
   ```
---
3. **Invalid assumer credentials**: The assumer's access key or secret key is wrong.
   ```bash
   # Test the assumer's credentials with a simple S3 call first
   AWS_ACCESS_KEY_ID=<assumer-access-key> \
   AWS_SECRET_ACCESS_KEY=<assumer-secret-key> \
   aws --endpoint-url https://${S3_ENDPOINT} --no-verify-ssl \
     s3 ls 2>&1
   # If this fails with InvalidAccessKeyId, the assumer credentials are wrong
   ```


4. **Explicit deny in policy**: A `deny` statement in the assume_role_policy is blocking the request.
   ```bash
   # Check the endpoint logs for the policy evaluation result
   kubectl logs -l noobaa-s3=noobaa -n <namespace> --tail=100 | grep "authorize_request_policy\|is_statements_fit"
   # Look for "permission is: DENY" or "permission is: IMPLICIT_DENY"
   ```

---

#### Issue: `InvalidClientTokenId` on S3 requests with session token

**Possible causes:**

1. **Corrupted session token**: The JWT is malformed or truncated. Ensure the full `SessionToken` value from the `AssumeRole` response is used.
   ```bash
   # Verify the token is a valid JWT (should have 3 dot-separated parts)
   echo "<session-token>" | awk -F'.' '{print NF " parts"}'
   # Expected: "3 parts"
   ```

2. **Wrong JWT secret**: If NooBaa pods were restarted with a different JWT secret, previously issued tokens become invalid.
   ```bash
   # Check if endpoint pods were recently restarted
   kubectl get pods -l noobaa-s3 -n <namespace> -o custom-columns=NAME:.metadata.name,STARTED:.status.startTime,RESTARTS:.status.containerStatuses[0].restartCount
   ```
---
#### Issue: Role not found (`NO_SUCH_ROLE`)

**Cause:** The account referenced in the RoleArn either doesn't exist or doesn't have a `role_config`, or the `role_name` in the ARN doesn't match the account's `role_config.role_name`.

**Debug steps:**
```bash
# Verify the role exists on the account in the DB
# Look for "role_config" and "role_name" in the output
oc rsh noobaa-db-pg-cluster-1
sh-5.1$ psql nbcore
nbcore=# select * from accounts;

# If the role is missing, assign one
noobaa sts assign-role \
  --email <account-email> \
  --role_config '{"role_name":"<role-name>","assume_role_policy":{"version":"2012-10-17","statement":[{"effect":"allow","action":["sts:AssumeRole"],"principal":["<assumer-email>"]}]}}'

# Verify the ARN components are correct
# Extract access key from ARN: arn:aws:sts::<THIS-PART>:role/<role-name>
echo "arn:aws:sts::AKIAIOSFODNN7EXAMPLE:role/MyRole" | awk -F: '{print "access_key=" $5; split($6,a,"/"); print "role_name=" a[2]}'
```
---
#### Issue: STS endpoint not reachable

**Debug steps:**
```bash
# Check that the STS service has endpoints (pods backing it)
kubectl get endpoints sts -n <namespace>
# If ENDPOINTS is <none>, no endpoint pods are running or the selector doesn't match

# Check endpoint pod health
kubectl get pods -l noobaa-s3 -n <namespace>

# Verify the STS port is open on the endpoint pod
ENDPOINT_POD=$(kubectl get pods -n <namespace> -l noobaa-s3 -o jsonpath='{.items[0].metadata.name}')
kubectl exec $ENDPOINT_POD -n <namespace> -- ss -tlnp | grep 7443

# Test connectivity from inside the cluster
kubectl run test-sts --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sk https://sts.<namespace>.svc.cluster.local:443/ -X POST -d "Action=GetCallerIdentity"

# Check if the route is properly configured (OpenShift)
oc get route sts -n <namespace> -o yaml | grep -A5 "spec:"
```

---

## Documentation Links

### NooBaa / Red Hat Documentation

- [Red Hat ODF 4.20 - Using MCG STS to Assume Role](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/html/managing_hybrid_and_multicloud_resources/using-the-multi-cloud-object-gateway-security-token-service-to-assume-the-role-of-another-user_rhodf)

### AWS Documentation

- [AWS STS - Temporary Security Credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html)
- [AWS STS API Reference - AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)
- [AWS STS API Reference - AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)
- [AWS STS Common Errors](https://docs.aws.amazon.com/STS/latest/APIReference/CommonErrors.html)
- [AWS IAM Roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)

---

## Demo

### Prerequisites

- A running NooBaa deployment (on OpenShift/Kubernetes)
- Access to the NooBaa CLI (`noobaa`) -- installed via `noobaa-operator`
- AWS CLI v2 installed (`aws --version`)
- `jq` installed for JSON parsing
- `oc` or `kubectl` access to the cluster namespace

---

### Environment Setup

```bash
# Set your namespace (adjust as needed)
export NAMESPACE=openshift-storage

# Verify NooBaa is running and healthy
noobaa status -n ${NAMESPACE}

# Get the STS endpoint URL
# Option A: From the OpenShift route
export STS_ENDPOINT=https://$(oc get route sts -n ${NAMESPACE} -o jsonpath='{.spec.host}')

# Option B: From the noobaa status output
noobaa status -n ${NAMESPACE} 2>&1 | grep -A10 "STS Addresses"

# Option C: Port-forward for local testing
# kubectl port-forward svc/sts -n ${NAMESPACE} 7443:443 &
# export STS_ENDPOINT=https://localhost:7443

# Get the S3 endpoint URL
# Option A: From the OpenShift route
export S3_ENDPOINT=https://$(oc get route s3 -n ${NAMESPACE} -o jsonpath='{.spec.host}')

# Option B: Port-forward for local testing
# kubectl port-forward svc/s3 -n ${NAMESPACE} 6443:443 &
# export S3_ENDPOINT=https://localhost:6443

# Verify endpoints are reachable (expect an XML error, not a connection error)
curl -sk ${STS_ENDPOINT}/ -X POST -d "Action=GetCallerIdentity" | head -5
curl -sk ${S3_ENDPOINT}/ | head -5

echo "STS Endpoint: ${STS_ENDPOINT}"
echo "S3 Endpoint:  ${S3_ENDPOINT}"
```

---
### Demo Steps

#### Step 1: Get Admin Credentials

```bash
# Get the admin (system owner) credentials from the noobaa-admin secret
export ADMIN_ACCESS_KEY=$(kubectl get secret noobaa-admin -n ${NAMESPACE} -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d)
export ADMIN_SECRET_KEY=$(kubectl get secret noobaa-admin -n ${NAMESPACE} -o jsonpath='{.data.AWS_SECRET_ACCESS_KEY}' | base64 -d)

# Verify admin credentials work
AWS_ACCESS_KEY_ID=${ADMIN_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ADMIN_SECRET_KEY} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 ls 2>&1

echo "Admin Access Key: ${ADMIN_ACCESS_KEY}"
```
---

#### Step 2: Create Two NooBaa Accounts

Create the "assumed" account (the one whose role will be assumed):

```bash
# Create the assumed account (role owner)
noobaa account create assumed.user --show-secrets -n ${NAMESPACE}

# Save the credentials from the output
export ASSUMED_ACCESS_KEY="<copy-access-key-from-output>"
export ASSUMED_SECRET_KEY="<copy-secret-key-from-output>"
```

Create the "assumer" account (the one that will assume the role):

```bash
# Create the assumer account
noobaa account create assumer.user --show-secrets -n ${NAMESPACE}
# Save the credentials from the output
export ASSUMER_ACCESS_KEY="<copy-access-key-from-output>"
export ASSUMER_SECRET_KEY="<copy-secret-key-from-output>"
```

Verify both accounts exist:

```bash
noobaa account list -n ${NAMESPACE}
```
---
#### Step 3: Assign a Role to the Assumed Account

```bash
# Assign a role that allows assumer.user to assume it
noobaa sts assign-role \
  --email assumed.user \
  --role_config '{"role_name":"DemoRole","assume_role_policy":{"version":"2012-10-17","statement":[{"effect":"allow","action":["sts:AssumeRole"],"principal":["assumer.user"]}]}}'

```
---
#### Step 4: Create a Bucket Owned by the Assumed Account

```bash
# Create a bucket using the assumed account's credentials
AWS_ACCESS_KEY_ID=${ASSUMED_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ASSUMED_SECRET_KEY} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 mb s3://demo-bucket 2>&1

# Upload a test file to the bucket
echo "This file belongs to assumed.user" > /tmp/demo-file.txt
AWS_ACCESS_KEY_ID=${ASSUMED_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ASSUMED_SECRET_KEY} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 cp /tmp/demo-file.txt s3://demo-bucket/test-file.txt 2>&1

# Verify the file is there
AWS_ACCESS_KEY_ID=${ASSUMED_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ASSUMED_SECRET_KEY} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 ls s3://demo-bucket/ 2>&1
```
---
#### Step 5: Verify the Assumer Cannot Access the Bucket Directly

```bash
# Try to list the demo-bucket using the assumer's OWN credentials -- should fail
AWS_ACCESS_KEY_ID=${ASSUMER_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ASSUMER_SECRET_KEY} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 ls s3://demo-bucket/ 2>&1

# Expected output: An error occurred (AccessDenied) ...
```
---
#### Step 6: Assume the Role via STS

```bash
# Construct the Role ARN using the assumed account's access key
export ROLE_ARN="arn:aws:sts::${ASSUMED_ACCESS_KEY}:role/DemoRole"
echo "Role ARN: ${ROLE_ARN}"

# Call AssumeRole using the assumer's credentials
ASSUME_ROLE_OUTPUT=$(AWS_ACCESS_KEY_ID=${ASSUMER_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ASSUMER_SECRET_KEY} \
aws --endpoint-url ${STS_ENDPOINT} --no-verify-ssl \
  sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "demo-session" \
  --output json 2>&1)

echo "${ASSUME_ROLE_OUTPUT}" | jq .

# Extract the temporary credentials from the response
export TEMP_ACCESS_KEY=$(echo "${ASSUME_ROLE_OUTPUT}" | jq -r '.Credentials.AccessKeyId')
export TEMP_SECRET_KEY=$(echo "${ASSUME_ROLE_OUTPUT}" | jq -r '.Credentials.SecretAccessKey')
export TEMP_SESSION_TOKEN=$(echo "${ASSUME_ROLE_OUTPUT}" | jq -r '.Credentials.SessionToken')
export TEMP_EXPIRATION=$(echo "${ASSUME_ROLE_OUTPUT}" | jq -r '.Credentials.Expiration')

echo "Temp Access Key: ${TEMP_ACCESS_KEY}"
echo "Temp Expiration: ${TEMP_EXPIRATION}"
```
---
**Expected output:**
```json
{
    "Credentials": {
        "AccessKeyId": "abc123...",
        "SecretAccessKey": "xyz789...",
        "SessionToken": "eyJhbGciOiJIUzI1NiIs...",
        "Expiration": "2024-01-01T02:00:00.000Z"
    },
    "AssumedRoleUser": {
        "AssumedRoleId": "<assumed-access-key>:demo-session",
        "Arn": "arn:aws:sts::<assumed-access-key>:assumed-role/DemoRole/demo-session"
    }
}
```
---
#### Step 7: Inspect the Session Token (JWT)

```bash
# Decode the JWT to see what's inside (without verification)
echo "${TEMP_SESSION_TOKEN}" | cut -d '.' -f 2 | base64 -d 2>/dev/null | jq .

# Expected output:
# {
#   "access_key": "<temp-access-key>",
#   "secret_key": "<temp-secret-key>",
#   "assumed_role_access_key": "<assumed-account-access-key>",
#   "iat": 1700000000,
#   "exp": 1700003600
# }

# Check when it expires in human-readable form
echo "${TEMP_SESSION_TOKEN}" | cut -d '.' -f 2 | base64 -d 2>/dev/null | jq '{issued: (.iat | todate), expires: (.exp | todate)}'
```
---
#### Step 8: Use Temporary Credentials to Access the Bucket

```bash
# List the demo-bucket using the TEMPORARY credentials -- should succeed!
AWS_ACCESS_KEY_ID=${TEMP_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${TEMP_SECRET_KEY} \
AWS_SESSION_TOKEN=${TEMP_SESSION_TOKEN} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 ls s3://demo-bucket/ 2>&1

# Expected: The test-file.txt uploaded earlier is listed
```
---
#### Step 9: Upload and Download Files Using Temporary Credentials

```bash
# Upload a new file using temp credentials
echo "Uploaded by the assumer using STS temp credentials!" > /tmp/sts-upload.txt
AWS_ACCESS_KEY_ID=${TEMP_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${TEMP_SECRET_KEY} \
AWS_SESSION_TOKEN=${TEMP_SESSION_TOKEN} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 cp /tmp/sts-upload.txt s3://demo-bucket/sts-upload.txt 2>&1

# Download a file using temp credentials
AWS_ACCESS_KEY_ID=${TEMP_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${TEMP_SECRET_KEY} \
AWS_SESSION_TOKEN=${TEMP_SESSION_TOKEN} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 cp s3://demo-bucket/test-file.txt /tmp/downloaded-file.txt 2>&1

cat /tmp/downloaded-file.txt

# List all objects to see both files
AWS_ACCESS_KEY_ID=${TEMP_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${TEMP_SECRET_KEY} \
AWS_SESSION_TOKEN=${TEMP_SESSION_TOKEN} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 ls s3://demo-bucket/ 2>&1
```
---
#### Step 10: Demonstrate Token Expiration

To demonstrate expiration quickly, request a short-lived token (minimum 900 seconds / 15 minutes):

```bash
# Get a new short-lived token
SHORT_LIVED_OUTPUT=$(AWS_ACCESS_KEY_ID=${ASSUMER_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ASSUMER_SECRET_KEY} \
aws --endpoint-url ${STS_ENDPOINT} --no-verify-ssl \
  sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "short-session" \
  --duration-seconds 900 \
  --output json 2>&1)

export SHORT_ACCESS_KEY=$(echo "${SHORT_LIVED_OUTPUT}" | jq -r '.Credentials.AccessKeyId')
export SHORT_SECRET_KEY=$(echo "${SHORT_LIVED_OUTPUT}" | jq -r '.Credentials.SecretAccessKey')
export SHORT_SESSION_TOKEN=$(echo "${SHORT_LIVED_OUTPUT}" | jq -r '.Credentials.SessionToken')

echo "Short-lived token expires at: $(echo "${SHORT_LIVED_OUTPUT}" | jq -r '.Credentials.Expiration')"

# Verify it works right now
AWS_ACCESS_KEY_ID=${SHORT_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${SHORT_SECRET_KEY} \
AWS_SESSION_TOKEN=${SHORT_SESSION_TOKEN} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 ls s3://demo-bucket/ 2>&1

echo "Token works now. Wait 15 minutes and try again..."
echo "Run: AWS_ACCESS_KEY_ID=${SHORT_ACCESS_KEY} AWS_SECRET_ACCESS_KEY=${SHORT_SECRET_KEY} AWS_SESSION_TOKEN=${SHORT_SESSION_TOKEN} aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl s3 ls s3://demo-bucket/"
echo "Expected: An error occurred (ExpiredToken)"
```
---

After waiting for the token to expire:

```bash
# After 15+ minutes, use the expired token -- should fail
AWS_ACCESS_KEY_ID=${SHORT_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${SHORT_SECRET_KEY} \
AWS_SESSION_TOKEN=${SHORT_SESSION_TOKEN} \
aws --endpoint-url ${S3_ENDPOINT} --no-verify-ssl \
  s3 ls s3://demo-bucket/ 2>&1

# Expected: An error occurred (ExpiredToken) when calling the ListObjectsV2 operation:
#           The security token included in the request is expired
```
---
#### Step 11: Demonstrate Denied AssumeRole (Negative Case)

```bash
# Try to assume the role with an account NOT listed in the principal -- should fail
# Use the admin credentials to try assuming the role (admin bypasses, so create a third account)
noobaa account create --name outsider --email outsider@demo.test -n ${NAMESPACE}
export OUTSIDER_ACCESS_KEY="<copy-from-output>"
export OUTSIDER_SECRET_KEY="<copy-from-output>"

AWS_ACCESS_KEY_ID=${OUTSIDER_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${OUTSIDER_SECRET_KEY} \
aws --endpoint-url ${STS_ENDPOINT} --no-verify-ssl \
  sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "should-fail" 2>&1

# Expected: An error occurred (AccessDeniedException) ...
# Because outsider@demo.test is NOT in the assume_role_policy principal list
```
---
#### Step 12: Demonstrate System Owner Bypass

```bash
# The system owner (admin) can ALWAYS assume any role, even if not in the principal list
AWS_ACCESS_KEY_ID=${ADMIN_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${ADMIN_SECRET_KEY} \
aws --endpoint-url ${STS_ENDPOINT} --no-verify-ssl \
  sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "admin-bypass" \
  --output json 2>&1 | jq .

# Expected: Success -- admin can always assume any role
```
---
### Demo Important Points

1. **Before STS**: The assumer cannot access the assumed account's bucket (Step 5).
2. **Role assignment**: The admin assigns a role policy specifying who can assume the role (Step 3).
3. **AssumeRole**: The assumer calls the STS endpoint and receives temporary credentials (Step 6).
4. **JWT inspection**: The session token is a standard JWT containing the temp creds and the role reference (Step 7).
5. **Temporary access**: Using the temp credentials + session token, the assumer can now access the bucket (Steps 8-9).
6. **Expiration**: After the token expires, access is automatically revoked -- no manual cleanup needed (Step 10).
---

### Demo Important Points

7. **Access control**: Unauthorized accounts are rejected by the assume_role_policy (Step 11).
8. **System owner bypass**: The admin can always assume any role for emergency access (Step 12).
9. **Security**: Credentials are short-lived, not stored in the database, and the session token is a signed JWT that cannot be forged.

---

## Known Limitations

### Account Cache Delay

NooBaa caches account data in an in-memory LRU cache (`account_cache` in `src/sdk/object_sdk.js`) with a default TTL of **10 minutes** (`OBJECT_SDK_ACCOUNT_CACHE_EXPIRY_MS`). This means that changes to an account (e.g., role assignment/removal, access key updates, policy changes) may not take effect for up to 10 minutes on endpoint pods that have the old account data cached.

---

## Q&A

### Q-a: How does STS work from the moment a client does a PUT or GET to a NooBaa bucket?

When a client uses temporary STS credentials to perform an S3 operation (PUT, GET, etc.):

1. **Client prepares the request**: The client signs the HTTP request using the **temporary** `AccessKeyId` and `SecretAccessKey` (received from `AssumeRole`). It also includes the `X-Amz-Security-Token` header containing the JWT session token.

2. **S3 endpoint receives the request** (port 6443 on noobaa-endpoint pod):
   - `http_utils.authorize_session_token()` detects the `X-Amz-Security-Token` header and decodes/verifies the JWT. The JWT contains `{access_key (temp), secret_key (temp), assumed_role_access_key}`. If the JWT is expired, `ExpiredToken` is returned immediately.

---

3. **Credential swapping** in `signature_utils.authenticate_request_by_service()`:
   - `auth_token.access_key` is set to `assumed_role_access_key` (the role account's permanent access key).
   - `auth_token.temp_secret_key` is set to the temp secret key from the JWT.

4. **Account lookup**: The S3 endpoint loads the **role account** using `assumed_role_access_key` via `account_cache`.

5. **Signature verification**: The request's AWS signature is verified using the **temporary secret key** (not the role account's permanent secret). This confirms the client possesses the temp credentials that were issued.

---

6. **Authorization**: Bucket policies and IAM policies are evaluated against the **role account** (not the original assumer). The client effectively operates with the role account's permissions.

7. **S3 operation executes**: The PUT/GET/DELETE/etc. operation is carried out as if the role account made the request.

---
### Q-b: Which service/pod provides the STS endpoint?

The **noobaa-endpoint** pods provide the STS endpoint.

- **Pod**: `noobaa-endpoint` deployment pods (selector: `noobaa-s3: <system-name>`)
- **Container port**: 7443 (HTTPS only)
- **Kubernetes Service**: `sts` (LoadBalancer, port 443 -> 7443)
- **OpenShift Route**: `sts` (TLS reencrypt)
- **TLS certificate**: `noobaa-sts-serving-cert` secret
---

### Q-c: Where are the roles stored?

See [Technical Details - Role configuration](#role-configuration)

---

### Q-d: How to troubleshoot STS?

See [Section 3: Troubleshooting](#3-troubleshooting) for full details.

---

### Q-e: How is access control done from an S3 client request? How does STS play here?

**Normal S3 request (without STS):**

The client signs every request with its **permanent** `AccessKeyId` and `SecretAccessKey` using AWS Signature V4. NooBaa:
1. Extracts the `AccessKeyId` from the `Authorization` header.
2. Looks up the account by that access key.
3. Retrieves the account's `SecretAccessKey`.
4. Recomputes the signature and compares it to the one in the request.
5. If matched, the request is authenticated as that account.
6. Bucket policies and IAM policies are evaluated against that account.

---
**S3 request with STS temporary credentials:**

The client signs with **temporary** `AccessKeyId` and `SecretAccessKey`, and additionally includes the `X-Amz-Security-Token` header (the JWT session token). NooBaa:

1. Detects the `X-Amz-Security-Token` header.
2. Decodes and verifies the JWT (checks signature and expiry).
3. Extracts from the JWT: `{temp_access_key, temp_secret_key, assumed_role_access_key}`.
4. **Swaps** the access key: instead of looking up the account by the temp access key (which doesn't exist in the database), it uses `assumed_role_access_key` to load the **role account**.
---

**S3 request with STS temporary credentials:**

5. Verifies the request signature using `temp_secret_key` (from the JWT, not from the database).
6. Evaluates bucket policies and IAM policies against the **role account**.

The key insight: **the temporary credentials are never stored in the database**. They exist only inside the JWT. The JWT acts as both a credential container and an authorization proof. The `assumed_role_access_key` inside the JWT is the bridge between the temp credentials and the real account whose permissions should apply.

---
```
Normal S3:
  Client (AccessKey A, SecretKey A)
    → NooBaa loads Account A by AccessKey A
    → Verifies signature with SecretKey A (from DB)
    → Authorizes as Account A

STS S3:
  Client (TempAccessKey T, TempSecretKey T, SessionToken JWT)
    → NooBaa decodes JWT → gets {T, T, assumed_role_access_key R}
    → Loads Account R by AccessKey R (role account)
    → Verifies signature with TempSecretKey T (from JWT, not DB)
    → Authorizes as Account R (role account)
```
