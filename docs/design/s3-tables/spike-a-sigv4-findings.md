# Spike A - SigV4 encoding capture: findings

*RHSTOR-9664 · blocks [story 2](s3-tables-implementation-plan.md#2-sigv4-canonical-path-for-s3tables) ·
resolves [§3.6](s3-tables-design.md#36-authentication-and-the-action-vocabulary) and
[§15](s3-tables-design.md#15-open-questions) bullet 1 · run 2026-09-25*

## Answer

Every client tested signs the **same** canonical URI:

> **remove dot and empty path segments, then URI-encode the already-encoded wire path a
> second time** - encoded slashes survive as `%252F`.

In NooBaa terms, for the `s3tables` signing service the canonical path is
`AWS.util.uriEscapePath(path.posix.normalize(<raw wire path>))`, with the wire path taken
from `req.originalUrl` **undecoded** - no `%2F` rewrite, no `decodeURI`, no
`path.normalize` on a decoded string.

No client disagreed, so **no tolerance mechanism is needed**. Two further defects surfaced
that §3.6 does not mention and that story 2 must also fix; see [Three defects](#three-defects).

## Method

`src/tools/sigv4_capture_server.js` (added by this spike) stands in for the endpoint. For
each request it writes the raw socket bytes as a `.sreq` file, then recomputes the signature
under seven candidate canonical-path rules × three canonical-query rules × three payload-hash
candidates, and reports which combinations reproduce the signature the client sent. All
clients were configured with the signature suite's existing test key `AKIDEXAMPLE`, so the
captures drop into `signature_test_suite/` unchanged.

The candidate rules, over the wire path `P`:

| id | rule |
|---|---|
| `R1_raw` | `P` |
| `R2_single` | decode each segment, escape once |
| **`R3_double_norm`** | **`uriEscapePath(path.posix.normalize(P))`** |
| `R4_double` | `uriEscapePath(P)` - no normalization |
| `R5_collapse` | rewrite `%2F`→`/`, normalize, escape |
| `R6_noobaa` | what NooBaa computes today for every non-`s3` service |
| `R7_double_unslash` | `R3` with `%252F` put back as `/` |

and over the wire query string: `Q1_passthrough` (sort the wire pairs, decode nothing),
`Q2_reencode` (decode then re-escape), `Q3_noobaa` (today's `queryParamsToString` on the
parsed query).

## Results

### Reference signers, offline (24 crafted paths)

botocore's `SigV4Auth.canonical_request` as the reference, compared against each candidate
and against the AWS SDK JS v3 signer (`@smithy/signature-v4`'s `getCanonicalPath`, already
in `node_modules`):

| rule | agrees with botocore |
|---|---|
| **`R3_double_norm`** | **24/24** |
| `R8` = AWS SDK JS v3 | **24/24** |
| `R5_collapse`, `R7_double_unslash` | 18/24 |
| `R4_double` | 17/24 |
| **`R6_noobaa` (today)** | **15/24** |
| `R2_single` | 8/24 |
| `R1_raw` | 3/24 |

### Live clients

| Client | Version | Requests captured | Matching rule |
|---|---|---|---|
| `aws s3tables` CLI | aws-cli 2.36.28 | 12 | `R3` (`R4` indistinguishable) |
| PyIceberg REST catalog | 0.12.0 | 10 × 5 prefix modes | `R3` (`R4` indistinguishable) |
| Iceberg Java `RESTCatalog` | 1.11.0 | 7 × 2 property spellings | `R3`, plus the payload caveat below |
| AWS SDK JS v3 `@aws-sdk/client-s3tables` | 3.1140.0 | 5 | `R3` (`R4` indistinguishable) |
| Synthetic (botocore-signed, raw socket) | - | 13 | **`R3` only** where dot or empty segments appear |

`R3` matched **every single captured request**, with no exceptions. Real clients never emit
dot or empty segments, so they cannot separate `R3` from `R4`; the synthetic probes do, and
they come down on `R3`. That agrees with all three reference signers, which normalize by
default (botocore's `remove_dot_segments`, smithy's segment loop, the Java SDK's
`Aws4SignerParams.normalizePath` default `true`).

### The prefix is ours to choose, and it does not rescue us

`GET /v1/config` carries no prefix; the client takes it from the response's
`overrides.prefix`. AWS documents returning the **url-encoded ARN** there. The stub was run
in five modes to see what each does to the wire path:

| `overrides.prefix` | PyIceberg wire path | matches today's NooBaa? |
|---|---|---|
| `arn%3Aaws%3A…%3Abucket%2Fmytables` (AWS's spelling) | one segment, `%2F` intact | no |
| `arn:aws:…:bucket/mytables` (raw) | **two** segments, no `%2F` | only until a name carries a `%`-escape |
| `arn:aws:…:bucket%2Fmytables` (mixed) | one segment, one escape | no |
| `mytables` (bare) | one plain segment | only until a name carries a `%`-escape |
| absent | no prefix at all | only until a name carries a `%`-escape |

**The last three rows are the important finding.** Even with *no ARN anywhere in the path*,
today's rule still fails on `…/namespaces/ns%20with%20space` and on
`…/namespaces/ns1%1Fsub` - PyIceberg's own separator for a multi-level namespace. The defect
is not about ARNs; it is about any percent-escape in any path segment. Returning a raw prefix
is not a workaround, and it would cost story 13 a parsing ambiguity (`{prefix}` would span two
path segments). **Recommendation: return the percent-encoded ARN, exactly as AWS does.**

## Three defects

Story 2 needs all three; only the first is in §3.6 today.

### 1. Canonical path (§3.6, known)

Fixed by the `R3` rule above.

### 2. Canonical query string (new)

`_aws_request` decodes the query with `url.parse(..., true)` and re-serializes it with
`AWS.util.queryParamsToString`. Clients sign the wire bytes. The two agree only when the
client already percent-encoded every value and used no repeated or bare keys - which the CLI,
PyIceberg and Iceberg Java all happen to do, so it does not bite them. It does bite:

- `?warehouse=arn:aws:s3tables:…:bucket/mytables` with the ARN unencoded (`Q1` only);
- `?pageToken=&pageToken=x`, a repeated key (`Q1` only);
- `?force`, a valueless key (`Q1` only).

For `s3tables`, sort the wire pairs and emit them verbatim.

### 3. `x-amz-content-sha256` cannot be trusted as the payload hash (new, and it blocks every commit)

**Iceberg Java 1.11.0 sends a base64 digest in `x-amz-content-sha256` while signing the hex
one.** Captured verbatim from `createNamespace`:

```
x-amz-content-sha256: AbpxR78riA8m/Kr4ILNELJIwLcjDxmMWy/8nv2mZKKI=
signed payload hash : 01ba7147bf2b880f26fcaaf820b3442c92302dc8c3c66316cbff27bf699928a2
```

Both are SHA-256 of the same 37-byte body; only the encoding differs. This is the known
AWS-SDK-for-Java empty/`Algorithm.SHA256` checksum quirk that
`RESTSigV4AuthSession` works around only for empty bodies.

Consequences for story 2, on the TABLES listener:

- the payload hash used in the string-to-sign must be the **hex SHA-256 of the body**
  whenever the header is not a lowercase 64-char hex digest (and not `UNSIGNED-PAYLOAD` or
  `STREAMING-AWS4-HMAC-SHA256-PAYLOAD`);
- the request must **not** be rejected with `InvalidDigest` for a non-hex header, which is
  what today's `Buffer.from(hdr, 'hex').length !== 32` check does.

Without this, **every body-bearing Iceberg Java request fails** - `createNamespace`,
`createTable` and, most importantly, `updateTable`, i.e. every commit from Spark.

## Client quirks

- **Iceberg 1.11.0 deprecates `rest.sigv4-enabled`**, logging at startup:
  *"The property rest.sigv4-enabled is deprecated and will be removed in a future release.
  Please use the property rest.auth.type=sigv4 instead."* Both spellings load
  `org.apache.iceberg.aws.RESTSigV4AuthManager` and produce byte-identical signing. The
  signing name and region keep the **same** property names in both -
  `rest.signing-name` / `rest.signing-region`; there is no `rest.auth.sigv4.*` namespace.
  Story 20 should document `rest.auth.type=sigv4` and note the old spelling still works.
- **PyIceberg's SigV4 credentials come from `client.access-key-id` /
  `client.secret-access-key` / `client.region`**, not from `s3.*`. With neither set it
  silently falls back to the ambient AWS credential chain and signs with whatever real key
  the machine holds - it does not warn. Worth a line in story 20.
- **PyIceberg splices `prefix` into the path raw** (`quote()` is applied to namespace and
  table names, never to the prefix), and encodes a space as `%20`. **Iceberg Java** splices
  it raw too (`Joiner.on("/")`) but encodes a space as `+`. Both still land on `R3`.
- **PyIceberg sends `Original-Authorization: Bearer None`** alongside the signed header when
  no OAuth token is configured. Harmless; it is not in `SignedHeaders`.
- **Iceberg Java sends `?pageToken=`** - an empty value, not an omitted parameter - on
  `listNamespaces` and `listTables`.
- **`/iceberg` is signed as an ordinary path segment**, confirming §3.7. Both `/iceberg/v1`
  and `/v1` behave identically.
- **Neither the `aws s3tables` CLI nor the SDK validates the ARN client-side.** It sent
  `arn:aws:s3tables:::bucket/mytables` and the bare string `mytables` without complaint,
  despite the model's `TableBucketARN` pattern requiring a 12-digit account. A partial,
  free answer for Spike B - the library still needs its own check.

## Fixtures for [test 6]

31 captures are committed under
`src/test/unit_tests/util_functions_tests/signature_test_suite/s3tables/`:
`awscli/` (7), `pyiceberg/` (6), `icebergjava/` (4), `awssdkjs/` (3), `synthetic/` (11).
They are **not wired into `test_signature_utils.js`** - story 2 adds the single line below,
so `npm run mocha` stays green in the meantime (`add_tests_from` recurses, so one line
registers the whole tree):

```js
add_tests_from(path.join(SIG_TEST_SUITE, 's3tables'), '.sreq');
```

Measured with the prototype below applied: **253 passing, 0 failing** - the 31 new fixtures
plus all 222 pre-existing ones, S3 and `aws4_testsuite` included. Without it: **30 of the 31
fail.** The one that passes unpatched is PyIceberg's `/v1/config?warehouse=…`, which has no
ARN in the path and a fully encoded query - a useful control, not a gap.

## Prototype validated for story 2

Keyed on `service === 's3tables'` and nothing else. That matters: the `aws4_testsuite`
fixtures sign the service literally named `service`, and `get-space.creq` expects the
*single*-encoded `/example%20space/`, so a branch keyed on "not `s3`" would break them.

In `_aws_request` (`src/util/signature_utils.js`):

```js
const is_s3tables = service === 's3tables';
const u = url.parse(is_s3tables ? req.originalUrl : req.originalUrl.replace(/%2F/g, '/'), true);
let pathname;
if (service === 's3') {
    pathname = u.pathname.split('/').map(c => AWS.util.uriEscape(decodeURIComponent(c))).join('/');
} else if (is_s3tables) {
    // AWS's non-S3 rule: remove dot and empty segments, then URI-encode the already-encoded
    // path a second time. The SDK signer applies uriEscapePath() to whatever pathname()
    // returns, so returning the normalized wire path yields exactly that.
    pathname = path.posix.normalize(u.pathname);
} else {
    pathname = path.normalize(decodeURI(u.pathname));
}
...
const search_string = is_s3tables ? _canonical_query_verbatim(u.search) :
    (u.search ? equals_handling : '');
```

with `_canonical_query_verbatim` splitting the raw search on `&`, splitting each pair on its
first `=`, sorting, and rejoining - decoding nothing. Use `path.posix.normalize`, not
`path.normalize`, so the result does not depend on the platform.

Plus, wherever the TABLES listener sets `req.content_sha256_sig`, the defect-3 rule: fall
back to the hex digest of the body when the header is not a hex digest, and do not reject
a non-hex header.

The exact diffs are committed next to this document as
[`spike-a-story2-prototype.diff`](spike-a-story2-prototype.diff), so they stay versioned with
the code they patch: `git apply docs/design/s3-tables/spike-a-story2-prototype.diff`.

## Reproducing

```bash
node src/tools/sigv4_capture_server.js --port 8080 --client <name> \
     --prefix_mode encoded --out ./captures/<name>
```

then point a client at `http://127.0.0.1:8080` (IRC clients at
`http://127.0.0.1:8080/iceberg`) with access key `AKIDEXAMPLE`. The server prints, per
request, which rule combinations reproduce the client's signature. `--help` lists the
prefix modes. The same stub serves Spike B - it only needs a different response table.
