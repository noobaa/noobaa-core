# Spike B - AWS catalog client library ARN check: findings

*Blocks: stories 15, 16 and 17 · Design: [§3.5], [§6.1.4], [§14], [§15] ·
Plan: [Spike B](s3-tables-implementation-plan.md#spike-b-aws-catalog-client-library-arn-check)*

Goal: confirm that AWS's S3 Tables catalog client library, and the AWS SDK beneath it,
send requests for the ARN shapes [§3.5] accepts, and record the exact `location` and
`metadata-log` spellings the literal comparisons in [§6.1.4] have to match - before the
S3Tables facade is built around either assumption.

**Headline: one design change is required.** The library never round-trips a trailing
slash on the table location. [§3.3] assigns `s3://<backing-bucket>/<table-id>/`; the
document the library writes back says `s3://<backing-bucket>/<table-id>`. [§6.1.4]
compares those two strings literally, so **every `UpdateTableMetadataLocation` would fail
`400`** ([finding 6](#6-the-location-spelling---the-design-change-this-spike-forces)).
Everything else the spike set out to check came back clean.

## What was run

| Piece | Version |
|---|---|
| AWS S3 Tables catalog library | `software.amazon.s3tables:s3-tables-catalog-for-iceberg-runtime:0.1.8` |
| AWS SDK for Java v2 (inside that shadow jar) | `2.29.26`, Apache HTTP client |
| Spark | `apache/spark:3.5.3`, JDK 11 |
| Iceberg | `iceberg-spark-runtime-3.5_2.12:1.6.1` + `iceberg-aws-bundle:1.6.1` |
| AWS CLI | `aws-cli/2.36.28`, botocore `s3tables` model `2018-05-10` |
| Catalog endpoint | `src/tools/s3tables_stub_server.js` over HTTP |
| Object store | **real NooBaa** (ODF on OpenShift), bucket `mytables--table-s3-nb`, `S3FileIO` with path-style access |

The stub is a stateful S3 Tables control plane: it keeps namespaces and tables in memory,
issues real version tokens and enforces them, writes every request as a `.sreq` fixture
and every state change to a JSONL journal. It reuses Spike A's listener, raw-byte capture
and signature analysis. The object store is the real thing, so the metadata and data files
quoted below were read back out of NooBaa, not out of a mock.

Catalog configuration, which is also the answer to "does the endpoint override work":

```
spark.sql.catalog.s3tb                  = org.apache.iceberg.spark.SparkCatalog
spark.sql.catalog.s3tb.catalog-impl     = software.amazon.s3tables.iceberg.S3TablesCatalog
spark.sql.catalog.s3tb.warehouse        = <the ARN shape under test>
spark.sql.catalog.s3tb.s3tables.endpoint = http://<stub>:8080
spark.sql.catalog.s3tb.client.region    = us-east-1
spark.sql.catalog.s3tb.s3.endpoint      = https://<noobaa s3 route>
spark.sql.catalog.s3tb.s3.path-style-access = true
```

Scenario: `CREATE NAMESPACE`, `CREATE TABLE ... USING iceberg`, two `INSERT`s, a
`SELECT count(*)`. It returned 2 rows - the whole path works end to end against a
NooBaa-shaped catalog.

## 1. The endpoint override is honoured, unconditionally

`s3tables.endpoint` is a real, supported property:
`S3TablesProperties.S3TABLES_ENDPOINT` is applied as `endpointOverride` on the
`S3TablesClientBuilder` by the default client factory
(`S3TablesAwsClientFactories.DefaultS3TablesAwsClientFactory.s3tables()`). The service's
endpoint rule set returns a set `Endpoint` verbatim - its only other conditions are FIPS
and dual-stack, both errors with a custom endpoint - and **it never looks at the ARN**.
The CLI's `--endpoint-url` resolves through the same rule set.

Confirmed on the wire: every request arrived at the stub with `Host: <stub host>:8080`.

## 2. Every ARN shape is sent; neither client validates it

| Shape | Library | CLI | Path on the wire |
|---|---|---|---|
| `arn:aws:s3tables:us-east-1:000000000000:bucket/mytables` | sent | sent | `/namespaces/arn%3Aaws%3As3tables%3Aus-east-1%3A000000000000%3Abucket%2Fmytables` |
| `arn:aws:s3tables::000000000000:bucket/mytables` | sent | sent | `/namespaces/arn%3Aaws%3As3tables%3A%3A000000000000%3Abucket%2Fmytables` |
| `arn:aws:s3tables:::bucket/mytables` | sent | sent | `/namespaces/arn%3Aaws%3As3tables%3A%3A%3Abucket%2Fmytables` |
| `mytables` (bare name) | sent | sent | `/namespaces/mytables` |

Nothing was rejected client-side, and the two clients agree on the encoding: the ARN is
one non-greedy path parameter, so its colons and its one slash are percent-encoded and it
stays a single segment.

The service model does carry a pattern -
`arn:aws[-a-z0-9]*:[a-z0-9]+:[-a-z0-9]*:[0-9]{12}:bucket/[a-z0-9_-]{3,63}`, which allows an
empty region but requires a **12-digit account** - but botocore does not enforce `pattern`
traits (`awscli/botocore/validate.py` validates type, required and length only) and the
Java SDK does not generate pattern validation either. The pattern is documentation, not a
gate.

**Consequence for [§3.5]:** the permissive parser is reachable from both clients, so the
tolerance it describes is worth having rather than theoretical. The section's conclusion
stands unchanged - **publish the well-formed placeholder**
`arn:aws:s3tables:us-east-1:000000000000:bucket/<name>` and echo that shape back - but for
a different reason than the one it gives. It is not that a loose ARN would be blocked
client-side; it is that a well-formed one is what AWS documents and what a user migrating
a working configuration will already have.

## 3. The signing region comes from the client, not from the ARN

With the warehouse ARN naming `us-east-1` and the client configured `eu-west-1`, the
credential scope was:

```
Credential=AKIDEXAMPLE/20260928/eu-west-1/s3tables/aws4_request
```

The ARN's region field is inert on the client side. NooBaa must therefore accept whatever
region appears in the scope, exactly as it already accepts the service name from the scope
rather than asserting it ([§3.6]).

## 4. The canonical path is Spike A's rule; no new signature work

Every ARN-bearing request from the library and the CLI matched `R3_double_norm` and
`R4_double` and **never** `R6_noobaa`, which is what NooBaa computes today - the same
verdict [Spike A](spike-a-sigv4-findings.md) recorded for PyIceberg, Iceberg Java and the
`aws s3tables` CLI. Story 2's fix covers this client too; nothing further is needed for
stories 15 and 17.

Two details worth keeping:

- With the **bare-name** warehouse, every candidate rule matched, because the path
  contains no encoded character. That is a control, and it confirms Spike A's point that
  the defect tracks percent-encoding rather than ARNs.
- Unlike Iceberg Java 1.11.0, this client's `x-amz-content-sha256` **is** the hex digest of
  the body it signs. Spike A's third fix - take the payload hash from the body, not the
  header - is still required for Iceberg Java, but it is not exercised by this client.

Nine captures are committed as fixtures under
`src/test/unit_tests/util_functions_tests/signature_test_suite/s3tables/awscatalog/`,
**deliberately not registered** in `test_signature_utils.js`, exactly as Spike A left its
own: story 15 adds the one `add_tests_from` line.

Measured both ways. Registered on `master`, **8 of the 9 fail** - the ninth is the
bare-name capture, which has nothing encoded to get wrong, and is a control rather than a
gap. With Spike A's prototype (`spike-a-story2-prototype.diff`) applied, the suite runs
**262 passing, 0 failing**: 222 pre-existing, Spike A's 31, and these 9. Story 2's fix is
sufficient for AWS's catalog library; stories 15 and 17 inherit it.

*On the version tokens in these fixtures.* The stub issues `EXAMPLEversionToken<n>` rather
than a random hex string. A version token is opaque to the client - it is Iceberg's
equivalent of an ETag and authenticates nothing - but a random hex value next to a key
named `versionToken` reads as a credential to secret scanners, and a captured request
cannot be annotated after the fact without invalidating the signature it exists to verify.
The five fixtures carrying a token were therefore re-captured with the placeholder, against
a local object stub rather than the NooBaa cluster used for the measurements above. That
changes nothing in the `s3tables` requests these fixtures contain, and the suite results
are identical.

## 5. The `CreateTable` and commit flow, as observed

`CREATE TABLE s3tb.ns1.t1 (...) USING iceberg` produced, in order:

| # | Request | Note |
|---|---|---|
| 1 | `GET /namespaces/{arn}/ns1` | Spark checks the namespace |
| 2 | `PUT /namespaces/{arn}` | `CreateNamespace` |
| 3 | `GET /tables/{arn}/ns1/t1/metadata-location` | → `404 NotFoundException` |
| 4 | `PUT /tables/{arn}/ns1` | **`CreateTable` with no `metadata` member** |
| 5 | `GET .../metadata-location` | → `versionToken` + `warehouseLocation`, **no `metadataLocation`** |
| 6 | *(S3)* `PUT <location>/metadata/00000-<uuid>.metadata.json` | via `S3FileIO`, to NooBaa |
| 7 | `GET .../metadata-location` | re-read purely to take the token |
| 8 | `PUT .../metadata-location` | `UpdateTableMetadataLocation` |

Each `INSERT` repeats 6-8. This is exactly the shape [§6.1.3] and story 16 assume: a table
created with no metadata is uninitialized - a token and an assigned location, nothing
written - and story 17's imperative commit is what initialises it.

**One client-side check NooBaa must not break.** On every commit after the first,
`S3TablesCatalogOperations.doCommit` calls `checkMetadataLocation`, which compares
`base.metadataFileLocation()` with the `metadataLocation` the catalog just returned and
throws `CommitFailedException` on any difference. So `GetTableMetadataLocation` must return
the stored string **byte for byte**. Normalizing it on the way out - stripping a slash,
re-encoding, canonicalising the scheme - would make every second commit fail.

## 6. The `location` spelling - the design change this spike forces

The scenario was run twice, changing only what the stub returned as `warehouseLocation`:

| Assigned `warehouseLocation` | `location` written into `metadata.json` |
|---|---|
| `s3://mytables--table-s3-nb/<table-id>/` | `s3://mytables--table-s3-nb/<table-id>` |
| `s3://mytables--table-s3-nb/<table-id>` | `s3://mytables--table-s3-nb/<table-id>` |

**The library never round-trips a trailing slash.** Iceberg strips it, and every metadata
file in both runs - the first and both commits - carried the stripped form.

[§6.1.4] requires the document's `location` to equal the table's server-assigned location,
and [§6.1.1] says to compare literally, with no normalization. With [§3.3]'s trailing
slash, that comparison rejects every document AWS's own catalog library produces.

**Recommendation: assign the location without a trailing slash** - `s3://<backing-bucket>/<table-id>`
- and keep the literal comparison. The reasons to prefer this over tolerating both
spellings:

- It is what every client emits, so there is one spelling in the system rather than two.
- Story 11 builds the initial metadata for IRC-created tables through our own engine. If
  the engine writes `location` with a slash and the S3Tables path writes it without, one
  table has two spellings depending on which protocol created it - and story 19 requires
  the S3Tables `warehouseLocation` and the IRC-reported location to be equal.
- [§6.1.1]'s containment rule compares path segments, not string prefixes, so it needs no
  trailing slash to work.

If the trailing slash is kept for another reason, the fallback is to strip **exactly one**
trailing `/` from both sides before comparing, and only for this one field - not a general
normalization, which [§6.1.1] rules out for good reasons.

## 7. `metadata-log` - the descent check is safe as written

The last `metadata-log` entry of each commit equalled the pointer's stored
`metadata_location`, byte for byte:

```
commit 2 metadata-log[-1].metadata-file
  = s3://mytables--table-s3-nb/<table-id>/metadata/00001-<uuid>.metadata.json
pointer metadata_location at that moment
  = s3://mytables--table-s3-nb/<table-id>/metadata/00001-<uuid>.metadata.json
```

And the **first** commit's document carried `"metadata-log": []`, which is what [§6.1.4]
requires of the first commit of an uninitialized table. Both comparisons in [§6.1.4] can
stay literal; only the `location` one needs the change in finding 6.

## 8. A rejected first commit deletes the table, with the version token

Rejecting the first `UpdateTableMetadataLocation` with `400 BadRequestException` produced:

```
DELETE /tables/{arn}/nsf/tf?versionToken=<the token CreateTable returned>
```

This confirms story 16's requirement from the client side rather than from the source: the
optional version token on `DeleteTable` is not decoration, it is how AWS's catalog library
cleans up a table whose first commit failed, and a `DeleteTable` that ignored the token, or
rejected the request for carrying one, would leave the table behind.

The `00000-<uuid>.metadata.json` it had already written **stays in the backing bucket**.
Nothing deletes it - the client does not, and the table record is gone. This is the
orphaned-write case of [§7.4], reached through a path the design did not name, and it is
one more reason the docs (story 20) must say that orphaned files are not reclaimed.

## 9. Incidental findings, recorded because they were free

- **The `--table-s3-nb` suffix is not special-cased.** `S3FileIO` wrote and read
  `metadata.json`, manifest lists, manifests and Parquet files against
  `mytables--table-s3-nb` on a real NooBaa S3 endpoint with no addressing workaround. The
  current S3 endpoint rule set special-cases only `--x-s3`, `--xa-s3` and `--op-s3`. Early
  evidence for [test 9]; the real check still belongs to story 19, because a future SDK
  could add a suffix.
- **Default table properties** the library and Iceberg set are `owner` and
  `write.parquet.compression-codec=zstd`. Neither `write.data.path` nor
  `write.metadata.path` is set, so [§6.4] rule 3 is not tripped by a default
  configuration.
- **Format version 2** by default with Iceberg 1.6.1, so a v3 cap is not exercised by this
  client without asking for it.
- **Data files** landed at `<location>/data/<name>.parquet`, inside the table id prefix.
  In this run they carried no hash prefix, so the library's `S3TablesLocationProvider` was
  not the provider in play; either shape satisfies [§6.1.1].
- The user agent reports `s3tables-iceberg-catalog/0.1.5` even from the 0.1.8 jar - a stale
  constant in `S3TablesProperties`. Do not use it to identify the client version.

## Answers to the spike's "done when"

| Criterion | Result |
|---|---|
| Every ARN shape classified as sent or rejected client-side, for the library and the CLI | Done - all four shapes sent by both, no client-side validation (finding 2) |
| The shape to document and echo back is confirmed, or [§3.5] is updated | Confirmed: the well-formed placeholder. [§3.5]'s reasoning is amended - the loose form is not blocked client-side (finding 2) |
| `location` and `metadata-log` spellings recorded, and [§6.1.4]'s literal comparisons confirmed to accept them, or the design updated before story 17 | `metadata-log` accepted as written (finding 7). **`location` is not** - [§3.3] and [§6.1.4] updated to drop the trailing slash (finding 6) |

## Reproducing

```bash
# 1. the catalog stub (one scenario per run; state is in memory)
node src/tools/s3tables_stub_server.js --port 8080 \
     --warehouse_base s3://mytables--table-s3-nb --trailing_slash on \
     --client awscatalog --out /tmp/spikeB/captures

# 2. Spark with AWS's catalog library, pointed at it
spark-sql \
  --packages org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.6.1,\
org.apache.iceberg:iceberg-aws-bundle:1.6.1,\
software.amazon.s3tables:s3-tables-catalog-for-iceberg-runtime:0.1.8 \
  --conf spark.sql.extensions=org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions \
  --conf spark.sql.catalog.s3tb=org.apache.iceberg.spark.SparkCatalog \
  --conf spark.sql.catalog.s3tb.catalog-impl=software.amazon.s3tables.iceberg.S3TablesCatalog \
  --conf spark.sql.catalog.s3tb.warehouse='arn:aws:s3tables:us-east-1:000000000000:bucket/mytables' \
  --conf spark.sql.catalog.s3tb.s3tables.endpoint=http://127.0.0.1:8080 \
  --conf spark.sql.catalog.s3tb.client.region=us-east-1 \
  --conf spark.sql.catalog.s3tb.s3.endpoint="$NOOBAA_S3" \
  --conf spark.sql.catalog.s3tb.s3.path-style-access=true \
  -e "CREATE NAMESPACE IF NOT EXISTS s3tb.ns1;
      CREATE TABLE s3tb.ns1.t1 (id bigint, data string) USING iceberg;
      INSERT INTO s3tb.ns1.t1 VALUES (1, 'first');
      INSERT INTO s3tb.ns1.t1 VALUES (2, 'second');"

# 3. what the stub saw
cat /tmp/spikeB/captures/journal.jsonl

# 4. re-run with --trailing_slash off, and with --fail_first_commit, for findings 6 and 8
```

The `aws s3tables` CLI drives the same stub with `--endpoint-url http://127.0.0.1:8080`
and `--table-bucket-arn <shape>`.

<!-- Design doc anchors -->
[§3.3]: s3-tables-design.md#33-where-table-metadata-is-stored
[§3.5]: s3-tables-design.md#35-addressing-table-bucket-arns-and-the-irc-prefix
[§3.6]: s3-tables-design.md#36-authentication-and-the-action-vocabulary
[§6.1.1]: s3-tables-design.md#611-validating-a-client-supplied-location
[§6.1.3]: s3-tables-design.md#613-lifecycle-states
[§6.1.4]: s3-tables-design.md#614-validating-a-client-supplied-metadata-document
[§6.4]: s3-tables-design.md#64-four-rules-for-the-sdk
[§7.4]: s3-tables-design.md#74-concurrency-crashes-and-orphaned-files
[§14]: s3-tables-design.md#14-risks
[§15]: s3-tables-design.md#15-open-questions
[test 9]: s3-tables-design.md#test-9
