# Strict bucket quota

Status: design for strict bucket quota.
No code accompanies this document.

The default async quota — configuration, alerts, and aggregator enforcement —
stays as specified in [quota.md](quota.md). This document is only the strict path.

Audience: NooBaa maintainers who will implement this, and reviewers checking the
accounting and concurrency. The document is self-contained. Engineering judgment
is marked.

## 1. Introduction

### 1.1 What async quota does

A bucket may carry a size limit, an object-count limit, or both. The background
`md_aggregator` folds object metadata into `bucket.storage_stats` on its existing
cycle (30 seconds). `check_quota` reads those stats, raises the existing 80% and
100% alerts, and rejects a new upload with `OBJECT_QUOTA_EXCEEDED` once either
stat has reached its limit. The S3 endpoint maps that code to
`409 ObjectQuotaExceeded`.

The stats are eventually consistent. A writer can pass the check for as long as
the last aggregation cycle still shows the bucket under the limit, and a delete
does not free capacity until a later cycle. That lag is the reason for a second
mode.

### 1.2 What strict mode adds

A quota marked strict keeps a live byte count and a live object count, and
updates them on the same request that commits or removes the object. A write
that would pass either limit is rejected with `QUOTA_EXCEEDED`, mapped to
`403 QuotaExceeded`.

Strict mode is opt-in. A quota with no mode is async, and every existing caller
keeps the aggregator path. On a strict bucket the write path does not also call
`check_quota`. The aggregator numbers lag a delete, and a second verdict from
those numbers would keep denying capacity the live counter has already released.
Alerts and the quota percentages continue to read `storage_stats`.

### 1.3 Glossary

| Term | Meaning |
|---|---|
| **async quota** | The default. Limits are compared to `storage_stats` from `md_aggregator`. |
| **strict quota** | Limits are compared to the live counter. |
| **usage row** | One document in the new usage collection: bucket id, shard, bytes used, objects used. |
| **shard** | An integer in `[0, 9]`. A reservation is applied to the shard of the object id it is charged to. The bucket total is the sum of its ten rows. |
| **slot** | One object towards the quantity limit. A completed object and a delete marker each take one slot. An in-progress upload does not. |
| **reserve** | Add bytes and/or slots. Fails the request with `QUOTA_EXCEEDED` when the add would overflow. |
| **release** | Subtract bytes and/or slots, clamped at zero. Never fails the caller. |
| **null version** | The object row with no version id. Versioning `DISABLED` has only this row. Versioning `SUSPENDED` overwrites it. Versioning `ENABLED` never overwrites it. |

## 2. Scope

**In scope**

1. A strict mode on the existing quota configuration, stored on the bucket.
2. A live counter, created when strict mode is turned on and removed when it is turned off or the bucket is deleted.
3. Simple `PutObject`: admit when the upload is created, reserve when it completes, release on delete.
4. Multipart: reserve each completed part's bytes, reserve the object slot when the upload completes, release bytes of parts the completed object does not keep, release those bytes on abort and on incomplete-upload expiration.
5. Versioning `ENABLED`, `SUSPENDED`, and `DISABLED`: new versions, null-version overwrite, delete markers, and version-id delete.
6. Release on single delete, multi-object delete, lifecycle expiration of noncurrent versions, lifecycle removal of expired delete markers, and lifecycle removal of incomplete multipart uploads.

**Out of scope**

- Namespace buckets, including NSFS. Strict mode is rejected when the quota is set. The counter lives in the metadata pool and is updated from the object server, which is not on the namespace write path.
- Turning strict mode on for a bucket that already has objects. There is no backfill from `storage_stats` or from a scan of object rows.
- Replacing async quota. Alerts and quota percentages keep reading `storage_stats`.
- Operator, OBC, and CLI surfaces. They already pass quota configuration through; strict mode is a field on that object. A UI control is separate.

## 3. Design decisions

### 3.1 The counter is its own collection

`bucket.storage_stats` is the wrong place for a per-request increment.

- `system_store` reloads and broadcasts on every config write. A counter update on that path would stall every endpoint on one bucket's quota.
- `md_aggregator` already owns `storage_stats`, on a 30 second cycle. Writing it from the data path would serialize uploads behind that cycle, which is the lag strict mode exists to remove.

The counter is a new collection on the metadata pool. Each update is one parameterized statement against a document of about a hundred bytes. Object metadata, chunk maps, and `storage_stats` are left alone.

### 3.2 N shards, keyed by the charged object id

Each bucket has N rows, shard 0 through N-1, created when strict mode is enabled.
The shard of an object id is the low 32 bits of that id, interpreted as hex, modulo N.
Reads sum every shard. Writes touch one shard.

The shard key is the id that owns the reservation:

- A new object is charged to its own id.
- A multipart part is charged to the parent upload's id, so every part of one upload, and the later release of an unused part, hit the same row.
- A delete marker is charged to an id allocated before insert. That same id is the marker row's id. The existing marker inserts (`insert_object_delete_marker`, `insert_object_delete_marker_move_latest`, `insert_object_delete_marker_move_latest_with_delete`) have to accept that id instead of allocating their own.
- An overwrite of a null version is a size delta and does not take a second slot. The existing completion path, `complete_object_upload_mark_remove_by_key`, soft-deletes the old row and completes a new row with a new id. The charge has to end on that new id, because a later delete releases whatever row is still live. The limit check uses the net delta (byte change, zero slots) so a bucket already at its object limit can still overwrite.

Give each bucket N independent counters instead of one. On complete, pick one shard and update only that using. Hash using for that is,
```
shard = hash(obj_id) % N
```

When the N is 4, then Quota schema for bucket entries looks like this

| _id 1 | owner_id | shard | used_bytes | used_objects
| --- | --- | --- | --- | --- | 
| 12345a | 12345 |0 | 1Gi |  1| 
| 12345a | 12345 | 1 | 2Gi | 3 |
| 12345a | 12345 | 2 | 6Gi | 1 |
| 12345a | 12345 | 3 | 10Gi | 5 |
|  |  | SUM | 19Gi | 10 |

When validate the Quota, SUM of each row is calculated and that total value is compared against the current upload value


 N shards spread locks across the objects of one busy bucket. The limit check compares the summed total, read once, with the upload. The reserve then updates only the shard the object id hashes to, and that statement locks only that row. See §7.2 and §8.

### 3.3 Reserve when the bytes become durable, not when the upload starts

An in-progress simple upload holds no quota. `create_object_upload` consults the cache and rejects a client that will not fit before the body is written. The counter moves in `complete_object_upload`, after the size is known and before the object row is marked complete. If that metadata write fails, the reservation is reversed.

Multipart reserves earlier, because a completed part is already durable and the final object size is the sum of the parts the client keeps. `complete_multipart` adds that part's size and zero slots. Completion of the upload adds the slot only, then drops the bytes of completed parts the client left out. An upload abandoned before any part completes holds nothing.

This replaces the async rule in [quota.md](quota.md) (if init succeeded, the upload can be completed; check at init) for strict buckets only. Async buckets still follow that rule. Init cannot know the final size, and reserving at init would pin capacity for uploads that never complete.

### 3.4 Versioning changes what overwrite means

| Bucket versioning | Put of an existing key | Delete of a key, no version id |
|---|---|---|
| `DISABLED` | Size delta on the null version. Slot count unchanged. | Remove the object. Release its size and its slot. |
| `SUSPENDED` | Same as `DISABLED`: the null version is overwritten. Older version ids stay. | If a null version is removed, the delete marker takes its slot (net zero slots) and the removed object's bytes are released. A versioned object that stays keeps its usage. |
| `ENABLED` | Always a new version: its size and one slot. A null version left from before versioning was enabled is not overwritten. | The previous version stays. The delete marker is a new slot of size 0, and the delete is rejected when that slot does not fit. |

A delete by version id removes that row. It releases one slot and that row's size. It does not create a marker. An in-progress upload deleted by version id releases completed part bytes only, because the upload itself was never given a slot.

These are the same counting rules as [quota.md](quota.md). Strict mode applies them on the request instead of on the next aggregation cycle. A versioned delete can fail with `403 QuotaExceeded` while `storage_stats` still shows the bucket under the limit.

### 3.5 Release never fails the user operation

Delete, abort, and rollback subtract usage and then drop the cached total for that bucket. A database error is logged and swallowed. Losing a release leaks usage, which later denies a write the bucket could have accepted. That is the direction a quota failure is allowed to take.

Release clamps each shard at zero, so a second release cannot drive the counter negative. The clamp also hides a release against the wrong shard: those bytes disappear into the clamp, and the shard that was actually charged keeps them. §3.2 exists so the charged id and the released id are the same id.

### 3.6 The cache is a fast reject, on the object server only

The object server keeps a process-local cache of the summed byte count and object count per bucket. Entries live for one second, and the cache holds at most 100 buckets. It exists so `create_object_upload` does not sum ten rows on every request.

The cache is process-local because these RPCs run in the object server. An S3 endpoint does not consult it. A release drops the entry so the next admit reloads the counter. The summed total in the cache is what admits or rejects the request. The database update that follows only adds the delta to one shard row. After a successful reserve, this process adds the delta into its cached numbers so the next admit on the same server sees it before the one-second refresh.

### 3.7 Strict mode starts at zero

The first time a bucket becomes strict it must contain no object rows, including in-progress uploads. The existing `has_any_objects_for_bucket` check is the test. The ten shards are inserted at zero. There is no aggregation pass to seed them.

Turning strict off, clearing the quota, or deleting the bucket deletes the rows. Changing the size or the count on a bucket that is already strict keeps the rows. Only the limits, which live on the bucket document, change.

A namespace bucket is rejected. A non-empty bucket is rejected with `INVALID_BUCKET_STATE`.

## 4. Architecture

```mermaid
flowchart LR
    subgraph endpoint["S3 endpoint"]
        S3["PutObject / UploadPart / CompleteMultipartUpload / DeleteObject"]
    end
    subgraph objectServer["object server"]
        OS["existing object RPCs"]
        Cache["usage cache"]
        Counter["quota counter"]
    end
    subgraph md["metadata pool"]
        BQ["usage rows\n10 shards"]
        OBJ["object metadata / multiparts"]
    end
    S3 --> OS
    OS --> Cache
    OS --> Counter
    Cache -->|"sum on load"| BQ
    Counter -->|"update the one shard row"| BQ
    OS --> OBJ
```

The object server remains the place that knows versioning and multipart. The counter adds or subtracts a delta charged to an object id. It does not interpret versioning.

Limits come from the bucket's quota configuration. A dimension that is unset is unlimited, represented by the maximum signed 64-bit integer, so one comparison covers a size-only quota, a count-only quota, and a quota with both.

## 5. Stored records

One new collection on the metadata pool. Ten documents per strict bucket:

| Field | Role |
|---|---|
| row id | Identity of this shard row. Not the bucket id. |
| bucket id | Every read and write predicates on this. |
| shard | `0..N-1`. |
| bytes used | Sizes charged to this shard. Stored as an integer wide enough for a Postgres `bigint`. |
| objects used | Slots charged to this shard. Same integer width. |

The bucket document gains a mode on the existing quota object. The mode is stored only when it is strict, so async buckets stay mode-less and keep reading as async.

Usage visible to alerts and to bucket reads is still `storage_stats`. The live counter is not copied back onto the bucket. An admin can see the bucket under its quota in the percentage fields while a strict write is already being rejected, and the reverse after a burst the aggregator has not folded in yet.

Byte and object totals stay integers end to end. A conversion through a 53-bit float loses precision past about 9 PB. The value read from SQL stays a decimal string until the comparison, which uses an arbitrary-precision integer.

## 6. Accounting rules

A reservation is bound to an object id. Every later release of those bytes or that slot uses the same id, because the shard is a function of the id.

| Operation | Bytes | Slots | Charged id |
|---|---|---|---|
| Simple PUT, new key, any versioning | `+size` | `+1` | new object |
| Simple PUT, versioning `ENABLED`, key already exists | `+size` | `+1` | new version. Previous versions stay charged. |
| Simple PUT, `DISABLED` or `SUSPENDED`, null version exists | `newSize - oldSize` | `0` | move the charge from the old row's id to the new row's id. The limit sees only the net delta. |
| Part complete | `+partSize` | `0` | the parent upload |
| Multipart object complete | `0` beyond the part bytes already held, then `-unused` | `+1`, or `0` when a null version is overwritten | parent upload. An overwritten null version is released in full and its slot moves to the upload id. |
| Delete of a completed object or a specific version | `-size` | `-1` | that row |
| Delete marker that does not remove an object | `0` | `+1` | the marker id allocated before insert |
| Delete marker that replaces a removed null version | `-size` of the removed object | `0` net (`+1` marker, `-1` removed) | marker id, and the removed object's id |
| Delete or abort of an in-progress upload | `-sum of completed parts` | `0` | the upload id |
| Abort before any part completes, and before a simple upload completes | `0` | `0` | nothing was reserved |
| Lifecycle: noncurrent version, expired delete marker, incomplete multipart | same as deleting that row | same | that row, or the upload id for an incomplete multipart |

Zero-byte objects still take a slot. A delete marker takes a slot and zero bytes. A row with an upload still in progress takes neither, until a part or the object is completed.

Overwrite under `DISABLED` or `SUSPENDED` is a delta, so a smaller replacement frees bytes at complete time and a larger one can be rejected. The slot is not taken twice.

## 7. How the existing object path changes

### 7.1 Where the work sits

Quota configuration is already applied when a bucket is updated, in the existing bucket update path. That path grows three branches:

1. Clearing the quota removes the usage rows when the previous mode was strict.
2. Setting strict mode on a namespace bucket fails with `BAD_REQUEST`. Setting it on a bucket where `has_any_objects_for_bucket` is true fails with `INVALID_BUCKET_STATE`. The first successful transition inserts ten zero rows. A repeated enable, when the rows already exist, does not reset them.
3. Switching a strict bucket back to async deletes the rows and stores the quota without a mode. Changing the numbers while the bucket stays strict does not touch the rows.

Deleting the bucket deletes the rows along with the rest of the bucket's metadata.

If two enables race and the insert hits a duplicate, the loser resets every row for that bucket id back to zero. The reset matches on the bucket id, not on a single row id, because each shard has its own row id.

### 7.2 Reserve and release

Both operations take a bucket, an object id, a byte delta, and a slot delta. A zero delta is a no-op. A bucket that is not strict is a no-op.

**Reserve** updates one row: the shard `hash(object id) % N` for that bucket. Bucket `12345` and hash `2` touch only the row whose bucket id is `12345` and whose shard is `2`. The statement locks that row for the update. The other shard rows of the bucket stay unlocked, so an upload that hashes to shard `0` does not wait on shard `2`.

1. The admit check has already compared the summed total with the delta (§7.3). Reserve does not lock the other shards to recompute that sum.
2. Add the delta on the one shard row. A byte-only delta leaves the slot field untouched, and a slot-only delta leaves the byte field untouched.
3. Reject when that row is missing. Missing rows mean strict mode was not initialized. The request fails with `QUOTA_EXCEEDED`.
4. On this process, add the same delta to the cached totals.

A move between two object ids (an overwrite whose old row and new row hash to different shards) updates those two rows, and locks those two. It still does not lock the rest of the bucket.

**Release** subtracts on the one shard, clamping each field at zero, then drops the cache entry. It does not take the admit lock and it does not fail the caller. Release of a positive byte delta and a negative one share the same statement shape; release passes the deltas already negated.

**Size adjust** is the overwrite primitive used when the charged id does not change. The delta is the new size minus the size already charged. A positive delta reserves, a negative delta releases, and zero is a no-op. Overwrite across two ids (§7.5) does not use this. It releases the old id and reserves the new id under one limit check of the net delta.

**Release of a set of rows** is what lifecycle and bulk delete need. Walk the removed rows. Skip a row that is still an in-progress upload. A delete marker releases one slot and zero bytes. Any other completed row releases its size and one slot, on that row's id.

### 7.3 Reading the total

The total is the sum of the shard rows for one bucket. A bucket with no rows sums to zero. Reserve against a missing shard fails closed, so a cache that observed zero cannot commit a bucket whose rows were never created: the single-row update matches nothing and the request fails. Enabling strict mode inserts the rows first, so a configured strict bucket does not depend on that pair.

The fast path caches that sum. The cache check:

1. Returns immediately when the bucket is not strict, or when both deltas are zero. A missing `Content-Length` counts as zero bytes, so the check does not fail on an absent number.
2. Loads the sum from the cache or from the database.
3. Rejects with `QUOTA_EXCEEDED` when the sum plus the delta would pass either limit.

Two admits on one process for the same bucket run one after the other, cache check and database transaction together, so they cannot both pass on the same snapshot.

### 7.4 Simple PUT

```mermaid
sequenceDiagram
    participant S3
    participant OS as object server
    participant Cache as usage cache
    participant DB as usage rows

    S3->>OS: create_object_upload
    OS->>Cache: admit size and slots for this upload
    Cache-->>OS: allow, or QUOTA_EXCEEDED
    OS->>OS: insert upload row
    S3->>OS: complete_object_upload
    OS->>DB: update the one shard row, or the two rows of a move
    OS->>OS: commit object metadata
    OS->>DB: reverse the reservation if the commit fails
```

`create_object_upload` admits before it inserts the upload row:

- Versioning `ENABLED`: admit the object size and one slot. A null version already stored for the key is irrelevant, because this put does not replace it.
- Otherwise, look up the null version. If it exists, admit only a positive byte delta, with zero slots. A smaller replacement is not rejected here.
- If it does not exist, admit the size and one slot.

`complete_object_upload` reserves, then runs the existing completion, including its retries on a duplicate key. If completion fails, the reservation is reversed.

What gets reserved:

- Versioning `ENABLED`: the new object's size and one slot, on the new object's id.
- `DISABLED` or `SUSPENDED`, null version present: in one transaction, drop the old size and the old slot from the old id's shard and add the new size and one slot on the new id's shard. The limit check sees `newSize - oldSize` bytes and zero slots. A failure of the metadata write puts the old size and the old slot back on the old id and removes the new charge.
- No existing null version: the new size and one slot on the new id. A failure releases that charge.

The existing completion under `DISABLED` does not keep the null version's id. `complete_object_upload_mark_remove_by_key` soft-deletes the old row and completes the new one. Charging the new id is what makes the later `delete_object` of that key release the same shard.

### 7.5 Multipart

`CreateMultipartUpload` is `create_object_upload` with the upload marked in progress. It runs the same admit as a simple PUT and reserves nothing.

`UploadPart` is `create_multipart` followed by `complete_multipart`.

`create_multipart` admits the part's `Content-Length` as bytes and zero slots, then inserts the part row. A part whose size is not known yet (a copy, or a size learned while the body is read) admits zero bytes. The reservation waits until `complete_multipart`.

`complete_multipart`:

1. Uses the size stored at create, or the size learned on complete when create did not have one.
2. Reserves that many bytes and zero slots on the upload's id.
3. Updates the part row. If the update fails, releases those bytes on the upload id.

Completion of the multipart object goes through `complete_object_upload` with the client's part list:

1. The existing part assembly selects the parts the client named. Completed parts that were left out (they have a completion time and a positive size) contribute their sizes to a byte total, and their rows are deleted. Parts that were never completed were never reserved, so they contribute nothing.
2. Release that unused byte total, and zero slots, on the upload id.
3. Reserve the object slot. Versioning `ENABLED` adds one slot and no more bytes. `DISABLED` or `SUSPENDED` with a null version releases that null version in full (its size and its slot) and adds one slot on the upload id, so the net slot change is zero and the new bytes are the part reservations already on the upload id. The limit check uses the net delta.
4. Commit the object. If the commit fails, reverse the slot reservation and, when a null version was released, put that null version's charge back. The unused-part release is not restored: those part rows are already gone, and a retry of completion cannot see them. Do the unused-part release only after the object commit has succeeded, so a failed completion leaves the part bytes charged to the upload, which abort or a later successful completion can still release.

`abort_object_upload` deletes the upload row and then releases only what was reserved:

- No completed parts, and the upload is still in progress: release nothing. A simple upload reserves at `complete_object_upload`, so an abort before that has no charge.
- One or more completed parts: release the sum of their sizes and zero slots, on the upload id.

A version-id delete of an in-progress upload uses the same part-byte release. It does not also release a slot.

### 7.6 Versioning and delete markers

Versioning `ENABLED` is decided before any null-version lookup, both at admit time and at reserve time. The metadata path is the existing one: the previous latest is unmarked, the new row becomes latest, and no old row is deleted. Quota does not release the previous version. Deleting it later, by version id, does.

Versioning `SUSPENDED` still overwrites the null version, including the case where that null version is no longer latest and a versioned object is only unmarked. Quota follows the null version. The versioned object remains charged, because the row remains.

`delete_object` of a key, with no version id, creates a delete marker through the existing marker inserts. On a strict bucket the order is:

1. Allocate the marker id before any write.
2. If the marker does not replace a removed object, admit one slot and zero bytes. A full object quota fails here, before a marker exists.
3. Reserve one slot and zero bytes on that marker id.
4. Insert the marker with that id, via `insert_object_delete_marker`, `insert_object_delete_marker_move_latest`, or `insert_object_delete_marker_move_latest_with_delete`.
5. If the insert fails, release the slot.

When the marker replaces a removed null version, step 2 is skipped. `delete_object` then releases the removed object (its size and one slot). Net slots stay flat. Net bytes drop by the removed object's size. Between the marker reserve and that release the counter is one slot high, so a concurrent put can be rejected. That window is acceptable. The other ordering would let a put take the slot the marker is about to occupy.

A version-id delete of an in-progress upload does not release a slot. Completed objects and delete markers do.

### 7.7 Deletes and lifecycle

| Existing entry point | What it releases |
|---|---|
| `delete_object` | The removed completed object or delete marker: its size and one slot. An in-progress upload instead releases completed part bytes and no slot. |
| `delete_multiple_objects` | Same rules, per key. The existing fast path for a non-versioned bucket, which deletes by key in batches, releases each removed row the same way. |
| `delete_multiple_objects_by_filter` on a non-versioned bucket | The delete has to return the rows it removed. Quota releases each one. A second read after the delete would race with a recreate of the same key. |
| Same filter on a versioned bucket | Already goes through `delete_multiple_objects`, so marker and version-id rules apply per key. |
| `delete_multiple_objects_unordered` | Release each removed row after the existing bulk removal. |
| `delete_noncurrent_versions` | On a strict bucket the delete returns the rows it removed, and each is released. On an async bucket it still returns only a count. |
| `delete_expired_delete_markers` | Same. Each marker is one slot and zero bytes. |
| `delete_incomplete_multiparts` | Returns the uploads it removed. For each, release the sum of completed part sizes and zero slots, on that upload's id. |

### 7.8 Errors

| Code | HTTP | When |
|---|---|---|
| `QUOTA_EXCEEDED` | `403 QuotaExceeded` | The summed total rejected the delta, or the shard row for this object id is missing. |
| `OBJECT_QUOTA_EXCEEDED` | `409 ObjectQuotaExceeded` | Async `check_quota` saw `storage_stats` at or past 100%. Not used for a strict bucket. |
| `INVALID_BUCKET_STATE` | bucket API | Strict mode requested on a bucket that has objects. |
| `BAD_REQUEST` | bucket API | Strict mode requested on a namespace bucket, or a non-positive limit. |

The `QUOTA_EXCEEDED` message names the bucket. Release does not emit it.

### 7.9 The statement shape

Reserve and release are one update of the shard row for a bucket id and a shard number.

- The first two parameters are the bucket id and the shard.
- A byte-only change binds the byte delta and does not rewrite the slot field.
- A slot-only change binds the slot delta and does not rewrite the byte field.
- A change to both binds bytes then slots.
- Release wraps each sum so the stored value cannot go below zero.
- The statement returns the updated row. A reserve that matches nothing fails the request.

The sum that admits the request is a separate read. This update does not lock the other shards, and it does not recompute the total. Postgres locks the row the `WHERE` matches: one bucket id and one shard.

## 8. Concurrency and crashes

**One object server.** The cache check and the database transaction for a bucket run one at a time on that process. A successful reserve updates the cached numbers, so the next admit sees it.

**Several object servers.** Each has its own cache, so two servers can both pass the sum check. Their updates block each other only when they hash to the same shard. Two uploads that hash to different shards run at the same time, and both can commit. The shared cap is the cached sum, refreshed within a second and invalidated on release. That is the race sharding accepts. Closing it by locking every shard on every reserve would put all of the bucket's uploads back on one set of locks.

**Crash after reserve and before the metadata commit.** The request fails. The rollback runs only if this process is still handling the error. A crash in between leaks the reservation. The leak denies capacity. It does not allow an over-quota object to become visible. Turning strict mode off and on is not a repair: turning it on requires an empty bucket. A later reconciliation against object rows is the repair, and it is outside this design (§2).

**Crash after the metadata commit and before a release**, on the delete path. The object is gone and the counter still holds it. Same direction: a later write is denied early.

**Release of the wrong id.** The zero clamp drops the bytes on the shard that was not charged, and the charged shard keeps them. The sum stays high. §7.4 and §7.5 move or release the id that the metadata actually keeps, so delete and the original charge name the same id.

## 9. What does not change

- Async buckets. No usage rows, no extra reads on the put path, same `409` from `check_quota`.
- Alert thresholds and the quota percentages on bucket reads and partial stats. They keep using `storage_stats`.
- Object metadata, apart from the delete-marker inserts accepting an id chosen by the caller, and the lifecycle deletes returning the rows they removed when the bucket is strict.
- Namespace and NSFS writes.

