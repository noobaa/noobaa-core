# LDAP Group-Based Role Assumption — Design Proposal

## Background

NooBaa supports `AssumeRoleWithWebIdentity` for LDAP users, where a user sends a JWT token containing their LDAP credentials to obtain temporary S3 credentials scoped to a role. Currently, any authenticated LDAP user can assume a role — there is no mechanism to restrict assumption based on LDAP group membership or any specific attribute.

This proposal adds group-based access control to the `AssumeRoleWithWebIdentity` flow, allowing administrators to configure roles that only specific LDAP groups or departments can assume.

---

## Current Flow

```text
1. Client sends HTTP POST to STS:
      Action=AssumeRoleWithWebIdentity
      RoleArn=arn:aws:sts::<access_key>:role/<role_name>
      WebIdentityToken=<JWT containing username + password>

2. NooBaa extracts username and password from the JWT token

3. NooBaa authenticates the user against LDAP
      → receives the user's DN (Distinguished Name)

4. NooBaa fetches the account and role_config from the role ARN

5. Temporary credentials are issued to the caller
```

**Out of scope:** Step 5 always succeeds for any authenticated LDAP user. The `assume_role_policy` inside `role_config` is never evaluated for the `AssumeRoleWithWebIdentity` operation.

---

## Proposed Flow

```text
1. Client sends HTTP POST to STS:
      Action=AssumeRoleWithWebIdentity
      RoleArn=arn:aws:sts::<access_key>:role/<role_name>
      WebIdentityToken=<JWT containing username + password>

2. NooBaa extracts username and password from the JWT token

3. NooBaa authenticates the user against LDAP
      → receives the user's DN
      → additionally fetches: ou, memberOf attributes  [NEW]

4. NooBaa fetches the account + role_config (including assume_role_policy) from the role ARN

5. NooBaa evaluates the assume_role_policy against the user's LDAP attributes  [NEW]
      → True  : issue temporary credentials
      → False : return Access Denied
```

---

## Role Config Format

A role is configured by setting `role_config` on a NooBaa account. The account's `access_key` forms the role ARN:

```text
arn:aws:sts::<account_access_key>:role/<role_name>
```

### Example 1 — Restrict by OU (Department)

Only users whose LDAP `ou` attribute equals `Delivering Crew` can assume this role.

```json
{
  "role_name": "RoleB",
  "assume_role_policy": {
    "version": "2012-10-17",
    "statement": [
      {
        "effect": "allow",
        "principal": ["*"],
        "action": ["sts:AssumeRoleWithWebIdentity"],
        "condition": {
          "StringEquals": {
            "ldap:ou": "Delivering Crew"
          }
        }
      }
    ]
  }
}
```

### Example 2 — Restrict by Group Membership

Only members of `ship_crew` or `admin_staff` LDAP groups can assume this role. The `ForAnyValue` operator means the user's `memberOf` list needs to contain at least one of the listed values.

```json
{
  "role_name": "RoleB",
  "assume_role_policy": {
    "version": "2012-10-17",
    "statement": [
      {
        "effect": "allow",
        "principal": ["*"],
        "action": ["sts:AssumeRoleWithWebIdentity"],
        "condition": {
          "ForAnyValue:StringEquals": {
            "ldap:memberOf": [
              "cn=ship_crew,ou=people,dc=planetexpress,dc=com",
              "cn=admin_staff,ou=people,dc=planetexpress,dc=com"
            ]
          }
        }
      }
    ]
  }
}
```

### Example 3 — Multiple Conditions (OU AND Group)

Both conditions must be satisfied. The user must be in the `Delivering Crew` OU **and** be a member of `ship_crew`.

All conditions within a single `condition` block are evaluated with **AND** logic — every condition must pass.

```json
{
  "role_name": "RoleB",
  "assume_role_policy": {
    "version": "2012-10-17",
    "statement": [
      {
        "effect": "allow",
        "principal": ["*"],
        "action": ["sts:AssumeRoleWithWebIdentity"],
        "condition": {
          "StringEquals": {
            "ldap:ou": "Delivering Crew"
          },
          "ForAnyValue:StringEquals": {
            "ldap:memberOf": [
              "cn=ship_crew,ou=people,dc=planetexpress,dc=com"
            ]
          }
        }
      }
    ]
  }
}
```

### Example 4 — OR Conditions (OU OR Group)

The user must be in the `Delivering Crew` OU **or** be a member of `ship_crew` — either one is sufficient.

```json
{
  "role_name": "RoleB",
  "assume_role_policy": {
    "version": "2012-10-17",
    "statement": [
      {
        "effect": "allow",
        "principal": ["*"],
        "action": ["sts:AssumeRoleWithWebIdentity"],
        "condition": {
          "StringEquals": {
            "ldap:ou": "Delivering Crew"
          }
        }
      },
      {
        "effect": "allow",
        "principal": ["*"],
        "action": ["sts:AssumeRoleWithWebIdentity"],
        "condition": {
          "ForAnyValue:StringEquals": {
            "ldap:memberOf": [
              "cn=ship_crew,ou=people,dc=planetexpress,dc=com"
            ]
          }
        }
      }
    ]
  }
}
```

---

## Condition Operators

| Operator | Use Case | Behaviour |
|---|---|---|
| `StringEquals` | Single-value LDAP attribute (e.g. `ou`) | Exact string match |
| `ForAnyValue:StringEquals` | Multi-value LDAP attribute (e.g. `memberOf`) | At least one value in the user's list must match a value in the policy list |

---

## Stage 1 — Wire Web Identity Through `has_assume_role_permission`

**Stage 1** routes `AssumeRoleWithWebIdentity` through the existing `has_assume_role_permission` check (action + principal only; LDAP group/OU `condition` blocks are a later stage). Remove the early return `if (req.op_name !== 'post_assume_role') return;` in `authorize_request_policy` (`src/endpoint/sts/sts_rest.js`).

---

## Stage 2 — Evaluate LDAP `condition` Blocks

**Goal:** Evaluate `assume_role_policy` `condition` blocks (`ldap:ou`, `ldap:memberOf`) during `AssumeRoleWithWebIdentity`, using the role config examples above (Examples 1–4).

**Prerequisite:** Stage 1 must be in place — Web Identity already flows through `has_assume_role_permission` for action + principal.

### Why reorder?

Policy evaluation needs LDAP attributes (`ou`, `memberOf`) before `authorize_request_policy()`. Today LDAP auth runs in the handler (`get_assumed_ldap_user`). This need to be moved earlier in the flow.

### Request pipeline (Stage 2)

```text
AssumeRole (unchanged):
  authenticate_request → load_requesting_account → authorize_request_account → authorize_request_policy → handler

AssumeRoleWithWebIdentity:
  authenticate_request → authenticate_web_identity → load_identity_info
    → load_requesting_account (anonymous) → authorize_request_account → authorize_request_policy (+ conditions) → handler
```

---
### File changes (high level)

#### 1. `src/endpoint/sts/sts_rest.js`

- **`authenticate_request`:** after `authenticate_request_by_service`, call `authenticate_web_identity` + `load_identity_info` for Web Identity.
- **`authorize_request_policy`:** pass `identity_info` into policy check; extend `_is_statements_fit` for `ldap:*` conditions.

```javascript
async function authenticate_request(req) {
    signature_utils.authenticate_request_by_service(req, req.sts_sdk);
    if (req.op_name === 'post_assume_role_with_web_identity') {
        await req.sts_sdk.authenticate_web_identity(req);
        await req.sts_sdk.load_identity_info(req);
    }
}

async function authorize_request_policy(req) {
    // ...
    const identity_info = req.sts_sdk.identity_info;
    const permission = has_assume_role_permission(assume_role_policy, method, cur_account_email, identity_info);
}
```

#### 2. `src/sdk/sts_sdk.js`

- Add **`authenticate_web_identity(req)`** — JWT verify + LDAP bind (from `get_assumed_ldap_user`).
- Add **`load_identity_info(req)`** — store `{ dn, ou, ... }` on the SDK (similar to `load_requesting_account`).
- Slim **`get_assumed_ldap_user(req)`** — reuse `identity_info` + `_assume_role`; handler issues temp credentials only.

```javascript
async load_identity_info(req) {
    if (req.op_name !== 'post_assume_role_with_web_identity') return;
    this.identity_info = this._ldap_auth_result; // set by authenticate_web_identity
}

async get_assumed_ldap_user(req) {
    const account = await this._assume_role(req.body.role_arn);
    return { access_key: ..., role_config: account.role_config, ... };
}
```

#### 3. `src/util/ldap_client.js`

- **`authenticate()`** returns `dn`, `ou`, and other required attributes (not just `dn`).

```javascript
const search_options = {
    // ...
    attributes: ['dn', 'ou', ...]
};
return { dn: entry.dn, ou: entry.ou, ... || [] };
```

#### 4. Config-time validation

- Refactor **`validate_role_config`** to use shared **`_validate_policy`** (like `validate_bucket_policy`); reject malformed `condition` blocks at role create/update time.
