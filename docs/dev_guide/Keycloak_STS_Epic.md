# Epic: Support Keycloak with MCG Client STS — Dev Preview

## Table of Contents

- [Goal](#goal)
- [Problem](#problem)
- [Why This Matters](#why-this-matters)
- [Scope](#scope)
- [Architecture Overview](#architecture-overview)
- [End-to-End Flow](#end-to-end-flow)
- [Feature Areas Delivered](#feature-areas-delivered)
- [Configuration](#configuration)
- [Local Setup Guide (Keycloak + STS)](#local-setup-guide-keycloak--sts)
- [Trust Policy and ABAC](#trust-policy-and-abac)
- [Testing](#testing)
- [Related Documentation](#related-documentation)
- [Limitations](#limitations)

---

## Goal

Enhance Multicloud Object Gateway (MCG) Security Token Service (STS) to integrate with external OIDC providers — specifically **Keycloak** — so that customers can:

1. Use a Keycloak-issued access token with `AssumeRoleWithWebIdentity`.
2. Enforce stronger authentication (including 2FA at the IdP).
3. Obtain **short-lived** NooBaa/S3 credentials instead of relying on static long-lived keys.

Status: **Dev Preview**.

---

## Problem

The existing MCG STS implementation did **not** provide a production-oriented path to plug in an external OIDC identity provider such as Keycloak.

Without OIDC federation:

- Customers cannot reuse their enterprise IdP for MCG access.
- 2FA / MFA enforced by Keycloak cannot gate access to object data.
- Credential lifecycle remains tied to long-lived static access keys, which are higher risk if compromised.

---

## Why This Matters

Customers with sensitive data lakes accessed through MCG need stronger security controls. Static credentials, if leaked, grant persistent access. OIDC federation plus STS temporary credentials addresses that gap by:

- Requiring authentication (and optional 2FA) at Keycloak before credentials are issued.
- Issuing time-bounded session credentials that expire automatically.
- Allowing AWS-compatible clients (CLI/SDK) to use the same `AssumeRoleWithWebIdentity` workflow against MCG STS.

---

## Scope

### In scope

| Area | Description |
|------|-------------|
| Keycloak web identity | Accept and validate Keycloak access tokens on `AssumeRoleWithWebIdentity` |
| OIDC provider config | Operator CLI + Kubernetes Secret mounted into NooBaa endpoints |
| Token introspection | Validate tokens with Keycloak’s introspection endpoint (active / revoked) |
| IAM Role APIs | Create/list/get/delete roles; put/get/delete inline role policies |
| Role storage | First-class `iam_role` schema (migrated off account-embedded `role_config`) |
| Trust policies | Federated principal + condition evaluation for web identity |
| Session tags / ABAC | Propagate OIDC claims as session tags; enforce `aws:PrincipalTag` on S3 |
| IAM role policy enforcement | Validate S3 I/O requests against the assumed role’s inline IAM role policy |
| S3 with STS credentials | S3 I/O with temporary credentials issued by `AssumeRoleWithWebIdentity` |
| Caching | IAM role cache for STS/S3 authorization hot paths |
| Tests | Unit and integration coverage for Keycloak STS flows |

### Out of scope (Dev Preview)

- Full multi-IdP productization beyond Keycloak-focused OIDC config.
- Complete AWS IAM feature parity (managed policies, permission boundaries, etc.).
- Non-containerized (NC) NooBaa STS Keycloak support (STS remains ODF/MCG focused).

---

## Architecture Overview

![Keycloak STS architecture](https://github.com/user-attachments/assets/2311498c-54df-440b-988a-4a5bb3c66379)

### Components

| Component | Responsibility |
|-----------|----------------|
| **Client App** | Authenticates with Keycloak, calls STS `AssumeRoleWithWebIdentity`, then S3 with temporary credentials |
| **Keycloak** | JWT token generation; token verification via `.well-known/openid-configuration` and introspection |
| **NooBaa — STS service** | Validate and decode JWT; assume role; generate temporary credentials (`AccessKey`, `SecretKey`, `SessionToken`) |
| **NooBaa — S3 service** | Authenticate S3 requests using STS temporary credentials; enforce IAM role policy |

### Request flow

| Step | From | To | Action |
|------|------|-----|--------|
| 1 | Client App | Keycloak | Authentication request |
| 2 | Keycloak | Client App | `access_token` (JWT) |
| 3 | Client App | STS service | `AssumeRoleWithWebIdentity` (web identity token + role ARN) |
| 4 | STS service | Keycloak | `well-known/openid-configuration` (OIDC discovery) |
| 5 | STS service | Keycloak | Token introspection |
| 6 | STS service | Client App | Temporary credentials (`AccessKey`, `SecretKey`, `SessionToken`) |
| 7 | Client App | S3 service | S3 API calls using temporary credentials |
| 8 | S3 service | Client App | Data response |

### Key components (noobaa-core)

| Component | Path / role |
|-----------|-------------|
| STS op | `src/endpoint/sts/ops/sts_post_assume_role_with_web_identity.js` |
| STS SDK | `src/sdk/sts_sdk.js` — Keycloak/OIDC web identity handling |
| Keycloak client | `src/util/keycloak_client.js` — provider load, discovery, verify/introspect |
| Keycloak utils | `src/util/keycloak_utils.js` — introspection + `.well-known` discovery |
| IAM roles | `src/server/system_services/schemas/iam_role_schema.js` + IAM ops |
| Role resolution / cache | `src/endpoint/iam/iam_utils.js` and related account SDK cache |
| Config mount path | `/etc/noobaa-server/oidc/keycloak_config/config.json` |

### Key components (noobaa-operator)

| Component | Role |
|-----------|------|
| Endpoint secret mount | Mount Keycloak/OIDC secret into NooBaa endpoint pods when present |
| `noobaa system oidc` CLI | Validate and store Keycloak provider JSON in a Kubernetes Secret |

---

## End-to-End Flow

1. **Admin configures Keycloak** in NooBaa via operator CLI (`noobaa system oidc --type keycloak --configure ...`). Config is stored in a Secret and mounted on endpoint pods. Restart the endpoint pod after configuration.
2. **Admin creates an IAM role** (via IAM `CreateRole`) whose trust policy allows `sts:AssumeRoleWithWebIdentity` for a **Federated** OIDC principal matching the Keycloak issuer.
3. **Admin attaches an inline role policy** (`PutRolePolicy`) that grants the S3 permissions the temporary session should have (optionally conditioned on `aws:PrincipalTag/...`).
4. **Client authenticates to Keycloak** (password + optional 2FA) and receives an `access_token` (JWT).
5. **Client calls STS** `AssumeRoleWithWebIdentity` with `RoleArn`, `RoleSessionName`, and `WebIdentityToken` (anonymous STS call — no long-lived NooBaa keys required for this step).
6. **NooBaa STS**:
   - Fetches Keycloak `well-known/openid-configuration` for OIDC discovery when needed.
   - Introspects the token with Keycloak (must be `active`).
   - Decodes JWT `iss`, resolves the IAM role, and evaluates the trust policy (Federated principal, conditions, session tags / `aws:RequestTag/...`).
   - Issues temporary credentials (`AccessKey`, `SecretKey`, `SessionToken`).
7. **Client uses temporary credentials** against the S3 endpoint; S3 authenticates the request and enforces the assumed role’s inline policies and session tags (`aws:PrincipalTag`).

---

## Feature Areas Delivered

### 1. AssumeRoleWithWebIdentity + Keycloak

- Unified web-identity entry point that prefers Keycloak/OIDC when a configured provider matches the token issuer; otherwise falls back to the existing LDAP path.
- Token validation via **introspection** (checks active/revoked state), not local JWKS-only verification.
- Session tags extracted from OIDC claims and embedded in the STS session token when present.
- Source identity prefers `email` / `sub` (OIDC) or LDAP DN as applicable.
- AWS-aligned STS error mapping: expired token, invalid identity token, access denied.

### 2. IAM Roles as first-class entities

- Roles moved from account-embedded `role_config` to dedicated `iam_role` documents.
- Upgrade migration script migrates existing account roles idempotently.
- Role fields include owner, name, path, description, max session duration (1–12 hours), assume-role (trust) policy, and inline role policies.

### 3. IAM Role management APIs

AWS-compatible IAM operations for roles and inline role policies (see [STS Server](./STS%20Server.md)).

### 4. Authorization with temporary credentials

- Assumed-role sessions evaluate the role’s inline permission policies.
- `aws:PrincipalTag` conditions supported in S3 / identity policy evaluation (ABAC).
- Consistent principal ARN handling across STS, S3, and policy utilities.
- IAM role caching with invalidation on role/policy updates for STS and S3 hot paths.

### 5. Operator integration

- Mount Keycloak OIDC Secret into endpoint pods when configured.
- CLI to create/update Keycloak provider configuration.
- Keycloak config simplified to require issuer + client credentials + introspection endpoint (jwks_uri no longer required for Keycloak config).

---

## Configuration

### Operator CLI

```bash
noobaa system oidc \
  --type keycloak \
  --configure file://keycloak_config.json
```

Inline JSON is also supported. The CLI validates the payload and stores it in a Kubernetes Secret consumed by NooBaa endpoints.

### Provider config shape (Keycloak)

Required fields:

- `issuer`
- `client_id`
- `client_secret`
- `token_introspection_endpoint`

Example:

```json
{
  "providers": [
    {
      "issuer": "https://keycloak.example.com/realms/noobaa",
      "client_id": "noobaa-sts",
      "client_secret": "<secret>",
      "token_introspection_endpoint": "https://keycloak.example.com/realms/noobaa/protocol/openid-connect/token/introspect"
    }
  ]
}
```

Notes:

- At runtime, if `token_introspection_endpoint` is omitted from the mounted provider config, NooBaa can discover it from `{issuer}/.well-known/openid-configuration`. **`client_id` and `client_secret` are still required** for token introspection.
- Config is read from `KEYCLOAK_CONFIG_PATH` (default: `/etc/noobaa-server/oidc/keycloak_config/config.json`) and reloads on file change.

### Federated principal ARN (trust policy)

Format used for `Principal.Federated` 

```text
arn:aws:iam::<account_id>:oidc-provider/<issuer-host-and-path>
arn:aws:iam:::oidc-provider/<issuer-host-and-path>
```

Example trust policy statement:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/keycloak.example.com/realms/noobaa"
      },
      "Action": ["sts:AssumeRoleWithWebIdentity", "sts:TagSession"],
      "Condition": {
        "ForAnyValue:StringEquals": {
          "keycloak.example.com/realms/noobaa:aud": "noobaa-sts",
          "aws:RequestTag/Department": "Engineering"
        }
      }
    }
  ]
}
```

> **Note:** If a tags claim (`https://aws.amazon.com/tags`) is present in the web identity token, you must include `sts:TagSession` in `Action`. Without it, the trust policy check fails.

---

## Local Setup Guide (Keycloak + STS)

This section walks through running Keycloak locally (in-cluster), configuring JWT claims (Audience + Hardcoded claim), wiring NooBaa OIDC, creating an IAM role, and calling `AssumeRoleWithWebIdentity`.

### 1. Deploy Keycloak

Create `keycloak-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  labels:
    app: keycloak
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:latest
        args: ["start-dev"]
        env:
        - name: KEYCLOAK_ADMIN
          value: "admin"
        - name: KEYCLOAK_ADMIN_PASSWORD
          value: "admin"
        - name: KC_HOSTNAME_URL
          value: "http://keycloak.noobaa.svc.cluster.local:8080"
        - name: KC_HOSTNAME_ADMIN_URL
          value: "http://keycloak.noobaa.svc.cluster.local:8080"
        ports:
        - name: http
          containerPort: 8080
        readinessProbe:
          httpGet:
            path: /realms/master
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
```

Create `keycloak-service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  labels:
    app: keycloak
spec:
  ports:
  - name: http
    port: 8080
    targetPort: 8080
  selector:
    app: keycloak
  type: NodePort
```

Apply and verify:

```bash
kubectl apply -f keycloak-deployment.yaml -n noobaa
kubectl apply -f keycloak-service.yaml -n noobaa

kubectl get pods -n noobaa | grep keycloak
kubectl get service -n noobaa | grep keycloak
```

### 2. Access the Keycloak admin console

Port-forward Keycloak to the local machine:

```bash
kubectl port-forward svc/keycloak 8081:8080 -n noobaa
```

Open the dashboard at [http://127.0.0.1:8081](http://127.0.0.1:8081) and sign in with `admin` / `admin`.

<img src="https://github.com/user-attachments/assets/bf9ba99b-32d2-4bf6-a02a-e47dede22f40" alt="Keycloak admin console" width="650" />

### 3. Create a realm

1. Open **Manage realms** → **Create realm**.
2. Enter a realm name (for example `noobaa`).
3. Click **Create**.

<img src="https://github.com/user-attachments/assets/97500a1d-392d-4078-b5e5-e3cb1a0f298f" alt="Create realm" width="650" />

### 4. Create a client

1. Go to **Clients** → **Create client**.
2. Set **Client ID** to `noobaa-client` and **Client name** to any name (for example `noobaa-client`) → **Next**.

<img src="https://github.com/user-attachments/assets/85b3895b-e71a-4513-8be5-9bcd1702756d" alt="Create client" width="650" />

3. Under **Capability config**, enable:
   - **Client authentication**
   - **Service accounts roles** (required for `client_credentials` token generation)
   - **Authorization**
   - **Implicit flow**
   - **Direct access grants** (required for the `password` grant in step 6)
4. Click **Next** → **Save**.

5. Open the client **Credentials** tab and copy the **Client secret** (needed later for token generation and NooBaa OIDC config).

### 5. Configure JWT claims (dedicated scope mappers)

These mappers ensure the access token contains:

- An **audience** (`aud`) of `noobaa-client` (used in trust-policy conditions).
- An AWS-style **tags claim** (`https://aws.amazon.com/tags`) used for session tags / ABAC.

#### 5a. Audience mapper

1. Open **Clients** → select the client you created (for example `noobaa-client`) → **Client scopes**.
2. Open the dedicated scope (for example `noobaa-client-dedicated`).
3. Click **Configure a new mapper** (or **Add mapper** → **By configuration**).
4. Select **Audience**.
5. Fill in:
   - **Name:** any name (for example `keycloak-mapper`)
   - **Included Client Audience:** `noobaa-client`
6. Click **Save**.

<img src="https://github.com/user-attachments/assets/7d0755f4-025d-4d32-9857-be0aff77e051" alt="Audience mapper" width="650" />

#### 5b. Hardcoded claim mapper (session tags)

1. From the same dedicated client scope, click **Add mapper** → **By configuration**.
2. Select **Hardcoded claim**.
3. Fill in:
   - **Name:** any name (for example `keycloak-claim`)
   - **Token Claim Name:** `https://aws.amazon.com/tags`
   - **Claim value:**

     ```json
     {"principal_tags":{"Department":"Engineering","Project":"NooBaa"}}
     ```

   - **Claim JSON Type:** `JSON`
4. Click **Save**.

<img src="https://github.com/user-attachments/assets/1d0c34c0-b3f1-4d7d-9e26-c2a2bbf46568" alt="Hardcoded claim mapper" width="650" />

### 6. Generate an access token

Request a token from a client that can reach Keycloak. Use the **same issuer URL** as configured in NooBaa OIDC and in the IAM role trust policy (for example `http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa`). The token endpoint is:

```text
<issuer>/protocol/openid-connect/token
```

Replace `<CLIENT_SECRET>` with the secret from the client **Credentials** tab.

#### Option A: `client_credentials` 

Uses the client ID and client secret only — no Keycloak user login. 

```bash
curl -X POST \
  "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=noobaa-client" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "grant_type=client_credentials"
```

#### Option B: `password` (Keycloak user + client)

Uses a **user created in Keycloak** (username and password), in addition to the client ID and client secret. Requires **Direct access grants** enabled on the client (see step 4).

```bash
curl -X POST \
  "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=noobaa-client" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "grant_type=password" \
  -d "username=<KEYCLOAK_USER>" \
  -d "password=<KEYCLOAK_PASSWORD>"
```

Copy the `access_token` from the JSON response. Confirm the JWT `iss` claim matches the issuer URL you configured.

### 7. Verify the token on jwt.io

Paste the access token into [https://jwt.io](https://jwt.io) and confirm:

- `iss` is `http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa`
- `aud` includes `noobaa-client` (from the Audience mapper)
- Claim `https://aws.amazon.com/tags` contains `principal_tags.Department` / `Project` (from the Hardcoded claim mapper)

### 8. Create a trust policy and IAM role

Use NooBaa admin credentials and the IAM endpoint (see [STS Server](./STS%20Server.md) for environment setup and port-forward).

Set an IAM CLI alias (adjust the port if needed):

```bash
alias iam='AWS_ACCESS_KEY_ID=$NOOBAA_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$NOOBAA_SECRET_KEY aws --endpoint https://127.0.0.1:8082 --no-verify-ssl iam'
```

Save as `iam-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam:::oidc-provider/keycloak.noobaa.svc.cluster.local:8080/realms/noobaa"
      },
      "Action": ["sts:AssumeRoleWithWebIdentity", "sts:TagSession"],
      "Condition": {
        "ForAnyValue:StringEquals": {
          "keycloak.noobaa.svc.cluster.local:8080/realms/noobaa:aud": "noobaa-client",
          "aws:RequestTag/Department": "Engineering"
        }
      }
    }
  ]
}
```

Create the role:

```bash
iam create-role \
  --role-name test-role-iam \
  --assume-role-policy-document file://iam-trust-policy.json \
  --max-session-duration 3600
```

Example response:

```json
{
  "Role": {
    "Path": "/",
    "RoleName": "test-role-iam",
    "RoleId": "<ROLE_ID>",
    "Arn": "arn:aws:iam::<ACCOUNT_ID>:role/test-role-iam",
    "CreateDate": "<CREATE_DATE>",
    "AssumeRolePolicyDocument": {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Principal": {
            "Federated": "arn:aws:iam:::oidc-provider/keycloak.noobaa.svc.cluster.local:8080/realms/noobaa"
          },
          "Action": [
            "sts:AssumeRoleWithWebIdentity",
            "sts:TagSession"
          ],
          "Condition": {
            "ForAnyValue:StringEquals": {
              "keycloak.noobaa.svc.cluster.local:8080/realms/noobaa:aud": "noobaa-client",
              "aws:RequestTag/Department": "Engineering"
            }
          }
        }
      ]
    },
    "MaxSessionDuration": 3600
  }
}
```

Note the returned `Role.Arn` for the STS call below.

### 9. Configure NooBaa OIDC (Keycloak provider)

Create `keycloak_config.json` (replace `<CLIENT_SECRET>`):

```json
{
  "providers": [
    {
      "issuer": "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
      "client_id": "noobaa-client",
      "client_secret": "<CLIENT_SECRET>",
      "token_introspection_endpoint": "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa/protocol/openid-connect/token/introspect"
    }
  ]
}
```

Apply with the NooBaa CLI, then restart the endpoint pod so it picks up the mounted secret:

```bash
noobaa system oidc \
  --type keycloak \
  --configure file://keycloak_config.json
```

Restart the endpoint pod after configuring OIDC.

### 10. Port-forward STS and assume the role

```bash
kubectl port-forward svc/sts 8083:443 -n noobaa
```

Call `AssumeRoleWithWebIdentity` (replace `<ROLE_ARN>` and `<ACCESS_TOKEN>`):

```bash
aws sts assume-role-with-web-identity \
  --endpoint https://127.0.0.1:8083 \
  --role-arn <ROLE_ARN> \
  --role-session-name arn_root \
  --no-verify-ssl \
  --web-identity-token <ACCESS_TOKEN>
```

Example response:

```json
{
  "Credentials": {
    "AccessKeyId": "<ACCESS_KEY_ID>",
    "SecretAccessKey": "<SECRET_ACCESS_KEY>",
    "SessionToken": "<SESSION_TOKEN>",
    "Expiration": "<EXPIRATION>"
  },
  "SubjectFromWebIdentityToken": "<SUBJECT>",
  "AssumedRoleUser": {
    "AssumedRoleId": "<ACCOUNT_ID>:<ROLE_SESSION_NAME>",
    "Arn": "arn:aws:sts::<ACCOUNT_ID>:assumed-role/<ROLE_NAME>/<ROLE_SESSION_NAME>"
  },
  "Provider": "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
  "Audience": "noobaa-client",
  "SourceIdentity": "<SOURCE_IDENTITY>"
}
```

Use those temporary credentials against the S3 endpoint for object operations authorized by the role’s inline policies and session tags.

### 11. Use temporary credentials with S3

Port-forward the S3 service, then set an alias using the values from the `Credentials` block in the assume-role response:

```bash
alias s3-temp='AWS_ACCESS_KEY_ID=<ACCESS_KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY> AWS_SESSION_TOKEN=<SESSION_TOKEN> aws --endpoint https://127.0.0.1:<s3-port> --no-verify-ssl s3'
```

---

## Trust Policy and ABAC

| Capability | Behavior |
|------------|----------|
| Federated principal | Token issuer must match trust-policy OIDC provider ARN |
| `aws:RequestTag` | Evaluated in the trust policy during `AssumeRoleWithWebIdentity` (session tags from the web identity token). Supported condition operators: `StringEquals`, `ForAnyValue:StringEquals` |
| Session tags | Claims from Keycloak token become session tags on the temporary credentials |
| `sts:TagSession` | Required in trust policy when tagging is part of the assume flow |
| `aws:PrincipalTag` | Evaluated during S3 authorization for ABAC (inline IAM role policy). Supported condition operators: `StringEquals`, `StringNotEquals`, `StringEqualsIgnoreCase`, `StringNotEqualsIgnoreCase`, `StringLike`, `StringNotLike`, `Null` |

---

## Testing

### Automated

- Unit tests for trust-policy condition matching and tag extraction.
- IAM role cache hit/miss/invalidation tests.
- Integration suite: `src/test/integration_tests/api/sts/test_sts_keycloak_integration.js`
  - Basic `AssumeRoleWithWebIdentity` with mocked Keycloak
  - Trust-policy condition validation
  - S3 access with temporary session credentials
  - IAM role policy + `aws:PrincipalTag` ABAC
  - Federated principal / malformed policy cases

### Manual / demo checklist

See [Local Setup Guide (Keycloak + STS)](#local-setup-guide-keycloak--sts) for the full walkthrough. High-level:

1. Deploy Keycloak and create a client with Audience + Hardcoded claim mappers.
2. Configure NooBaa OIDC via `noobaa system oidc --type keycloak --configure ...`.
3. Confirm the Secret is mounted on endpoint pods at the Keycloak config path.
4. Create an IAM role with Federated trust policy for the Keycloak issuer.
5. Attach an inline role policy granting the needed S3 actions.
6. Obtain a Keycloak access token and verify claims on jwt.io.
7. Call `AssumeRoleWithWebIdentity` against the MCG STS endpoint.
8. Use returned temporary credentials for S3 operations; verify expiry and tag-based deny/allow.

---

## Related Documentation

- [STS Server (dev guide)](./STS%20Server.md) — baseline MCG STS (`AssumeRole`) documentation
- [LDAP AssumeRoleWithWebIdentity POC](../design/ldap.md) — prior web-identity path that Keycloak complements
- [AWS STS AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)
- [AWS IAM Roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [Red Hat ODF — Using MCG STS to Assume Role](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/html/managing_hybrid_and_multicloud_resources/using-the-multi-cloud-object-gateway-security-token-service-to-assume-the-role-of-another-user_rhodf)

---

## Limitations

- Keycloak is the validated OIDC target; other OIDC providers are not fully productized.
- Introspection-based validation requires network reachability from NooBaa endpoints to Keycloak.
- Feature is oriented to ODF/MCG deployments with operator-managed Secrets; NC support is not included.
- IAM surface covers role CRUD and inline policies needed for this epic — not full AWS IAM parity.
- Docs and UX may still evolve before GA (error messages, CLI help text, and operational runbooks).