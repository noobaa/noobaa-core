# Object Lock: why we support Governance Bypass (hosted and NC)

Status: **in progress** (PR [#9881](https://github.com/noobaa/noobaa-core/pull/9881))  
Audience: people who need the product story, not the auth implementation.

Auth internals (IAM vs bucket policy, hosted vs NC evaluators): [ExtraS3ActionAuth.md](./ExtraS3ActionAuth.md).

---

## 1. What Object Lock is

Object Lock is WORM: **write once, read many**. After an object is locked, normal delete or overwrite is blocked until the lock allows it.

Customers use this for retention (keep this object until a date) and for legal hold (keep it until a person turns the hold off). NooBaa exposes the same S3 APIs as AWS.

Two deployments, **same product promise**:

| | Hosted (OpenShift / ODF) | NC (standalone RPM) |
|---|---|---|
| Where objects live | NooBaa metadata + backing store | Files on disk |
| What the customer sees | Same S3 Object Lock APIs | Same S3 Object Lock APIs |

If Bypass works on hosted and not on NC (or the other way around), that is a product bug, not a “different feature.”

---

## 2. Two lock modes (this is the only Object Lock you need)

**GOVERNANCE** — “keep this until date X, unless someone with extra permission shortens or deletes it.”  
Used when retention is a policy, but an admin must still be able to clean up.

**COMPLIANCE** — “keep this until date X, no exceptions.”  
Nobody can shorten it or delete it early. Not even an admin. Bypass does **not** apply.

There is also **legal hold**: on/off. While it is on, delete is blocked regardless of dates. That is a separate control, not Bypass.

---

## 3. What “Bypass Governance” means

On AWS, a client that wants to delete (or shorten) a GOVERNANCE object must do two things:

1. **Ask** — send the Bypass header on that request.
2. **Be allowed** — have permission `s3:BypassGovernanceRetention` (IAM user/role policy, or bucket policy). Bucket owner / admin can do this without a special grant.

No header → we do not treat the request as Bypass. The object stays locked. That is intentional. A normal delete must not silently break Governance.

Bypass is **not** a master key. It never unlocks COMPLIANCE. It never ignores legal hold.

---

## 4. Why we are doing this work

### AWS parity

Customers (and QE) compare us to S3. If Governance objects cannot be deleted by a permitted user with the Bypass header, Object Lock is incomplete.

### The old switch was the wrong model

NC used an account flag (`allow_bypass_governance`). It was copied onto an IAM user **once**, at create time. After that:

- Parent account turns Bypass **on** → child user does **not** pick it up.
- Parent turns it **off** → child still has the old copy.

QE expected the child to follow the parent. That is not how AWS works, and the copy-on-create flag could not implement it.

We **removed the flag**. Do not bring it back.

### One rule for hosted and NC

Permission must come from **who the caller is** (IAM / role policy) or **what the bucket allows** (bucket policy) — the same idea as every other S3 action. Hosted already had that path. NC can store IAM user and role policies now, so NC must use them too. Otherwise a user with Bypass in their policy still cannot Bypass on NC unless someone also wrote a bucket policy.

---

## 5. What we are changing (behavior, not internals)

**Request without Bypass header**  
Unchanged for extra permission. Delete is still a delete. If the object is under Governance, it stays protected.

**Request with Bypass header**

| Who | Result |
|---|---|
| Admin or bucket owner | Allowed (they own the bucket) |
| IAM user or assumed role with Bypass in their policy | Allowed |
| Bucket policy Allows Bypass for that user | Allowed |
| Policy **Denies** Bypass | Denied, even if another policy Allows |
| No grant at all | Denied |

Same table on **hosted and NC**.

Putting a lock **on upload** (retention or legal-hold headers on PutObject) follows the same idea: those headers are extra permissions, not a free add-on to `s3:PutObject`. Dedicated lock APIs (PutObjectRetention / PutObjectLegalHold) already require their own permission, so they are not double-checked.

---

## 6. Code changes (this PR)

We are not rewriting Object Lock. Locks already enforce GOVERNANCE / COMPLIANCE / legal hold. This PR only changes **who is allowed to ask for Bypass** (and the similar extra permissions on upload).

### Already in the PR

| Area | What we did | Why |
|---|---|---|
| Account flag | Removed `allow_bypass_governance` | Copy-on-create did not follow the parent; not AWS |
| S3 endpoint | If the Bypass / lock-on-upload **header** is present, require that extra permission | No header → no extra check |
| Hosted | Extra permission from **IAM or bucket policy**; Deny wins; owner/admin allowed | AWS-like |
| NC (first cut) | Extra permission from **bucket policy** only; owner/admin allowed | IAM on NC was not safe to reuse yet |
| Storage / lock engine | Endpoint decides Bypass; storage still enforces the lock | Permission vs enforcement stay separate |

### What we are adding now (NC IAM)

NC can now store and **enforce** IAM user and role policies (already merged: role CRUD, role policy CRUD, inline-policy enforcement). Empty IAM policy is deny, like hosted. So extras can use the **same IAM check** on NC. We do not add a new flag or a second auth path.

**Before (NC extras):** skip IAM → only bucket policy.

**After (hosted and NC extras):** check IAM (user or assumed role) → then owner/admin → then bucket policy. Explicit Deny wins.

| File | Change |
|---|---|
| `src/endpoint/s3/s3_rest.js` | Stop skipping IAM on NC. Call the same IAM evaluator for extras on both deployments. |
| `src/test/unit_tests/endpoint/test_s3_bypass_governance_permission.test.js` | NC cases: IAM Allow without bucket policy; IAM missing → deny; bucket Allow still works; IAM Deny beats bucket Allow. |

No new APIs. `PutUserPolicy` / `PutRolePolicy` already exist. We only start **using** them for Bypass.

### What we are not changing in code

- How GOVERNANCE / COMPLIANCE / legal hold is stored or enforced (Postgres vs files on disk).
- COMPLIANCE still cannot be Bypassed.
- The old account flag stays deleted.
- NC still does **not** auto-give Bypass to user B just because the bucket policy named root A. B needs their own IAM grant, or the bucket policy must name B (or B is owner/admin). That inherit path exists on hosted only today.

---

## 7. Example (the story to remember)

Account **A** owns the bucket. User **B** is an IAM user under A. An object is under Governance retention.

- **B deletes with no Bypass header** → object stays locked. Correct.
- **B sends Bypass header but has no Bypass grant** → AccessDenied. Correct. (`s3:DeleteObject` alone is not enough.)
- **B’s IAM policy (or the role they assumed, or the bucket policy) Allows Bypass** → delete with header succeeds. Correct.
- **A (owner) sends Bypass header** → succeeds without a special grant. Correct.
- **Object is COMPLIANCE** → Bypass does not help anyone. Correct.

What is **not** the story: A turns on a hidden account switch and B magically inherits it.

---

## 8. How to test this (QE)

Do **not** use `account update --allow_bypass_governance`.

1. IAM user with only delete permission + Bypass header → AccessDenied.
2. Give that user (or their role) Bypass in IAM, same request → allowed.
3. Remove the IAM grant, Allow Bypass on the **bucket policy** instead → allowed.
4. Owner/admin Bypass without those grants → allowed.
5. Repeat on **NC RPM** and **hosted**. Same expectations.

---

## 9. What this is not

- Not a new Object Lock implementation. Locks already exist; this is **who may ask to skip Governance**.
- Not a way around COMPLIANCE or legal hold.
- Not parent-account flag inheritance.
- Not NC-only or hosted-only. Both, same rules.
