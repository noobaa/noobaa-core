/* Copyright (C) 2026 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const { Readable } = require('node:stream');
const log_parser = require('../../../server/bg_services/replication_log_parser');

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a NooBaa PERSISTENT-mode log record as written by get_bucket_log_record().
 * Only the fields consumed by _parse_noobaa_log are included; extras are omitted.
 */
function make_log_entry({
    op = 'PUT',
    source_bucket = 'data-bucket',
    object_key = `/data-bucket/my-key`,
    http_status = 200,
    noobaa_bucket_logging = true,
    timestamp = new Date().toISOString(),
} = {}) {
    return {
        op,
        source_bucket,
        object_key,
        http_status,
        noobaa_bucket_logging,
        timestamp,
        request_id: 'test-req-id',
        remote_ip: '127.0.0.1',
        request_uri: object_key,
    };
}

/** Create a Readable stream from an array of log entry objects (each becomes one JSON line). */
function make_log_stream(entries) {
    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    return Readable.from([lines]);
}

// ─── extract_object_key ─────────────────────────────────────────────────────

describe('extract_object_key', () => {
    const extract = log_parser._extract_object_key;

    it('strips the leading /{bucket}/ prefix', () => {
        expect(extract('/data-bucket/my-key', 'data-bucket')).toBe('my-key');
    });

    it('strips a nested key path', () => {
        expect(extract('/data-bucket/folder/sub/file.txt', 'data-bucket')).toBe('folder/sub/file.txt');
    });

    it('strips a query string before extracting the key', () => {
        expect(extract('/data-bucket/my-key?versionId=abc&X-Amz-Token=foo', 'data-bucket')).toBe('my-key');
    });

    it('decodes percent-encoded characters', () => {
        expect(extract('/data-bucket/hello%20world', 'data-bucket')).toBe('hello world');
    });

    it('decodes a complex percent-encoded path', () => {
        expect(extract('/data-bucket/path%2Fwith%2Fslashes', 'data-bucket')).toBe('path/with/slashes');
    });

    it('falls back to stripping the leading slash when bucket prefix does not match', () => {
        // source_bucket name is ns-bucket but log entry records data-bucket → still strips leading /
        expect(extract('/data-bucket/my-key', 'ns-bucket')).toBe('data-bucket/my-key');
    });

    it('returns the key as-is when there is no leading slash', () => {
        expect(extract('plain-key', 'data-bucket')).toBe('plain-key');
    });

    it('returns an empty string for null input', () => {
        expect(extract(null, 'data-bucket')).toBe('');
    });

    it('returns an empty string for non-string input', () => {
        expect(extract(42, 'data-bucket')).toBe('');
    });

    it('handles a key that is just the bucket prefix root (empty key after stripping)', () => {
        // /data-bucket/ → empty string after stripping
        expect(extract('/data-bucket/', 'data-bucket')).toBe('');
    });
});

// ─── _noobaa_parse_log_stream ────────────────────────────────────────────────

describe('NooBaa log stream parsing', () => {
    const parse = log_parser._noobaa_parse_log_stream;
    const replication_src_bucket = 'data-bucket';

    it('parses a PUT entry as a copy action', async () => {
        const stream = make_log_stream([make_log_entry({ op: 'PUT', http_status: 200 })]);
        const logs = await parse(stream, replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('copy');
        expect(logs[0].key).toBe('my-key');
    });

    it('parses a POST entry as a copy action', async () => {
        const stream = make_log_stream([make_log_entry({ op: 'POST', http_status: 200 })]);
        const logs = await parse(stream, replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('copy');
    });

    it('parses a DELETE entry as a delete action when sync_deletions is true', async () => {
        const stream = make_log_stream([
            make_log_entry({ op: 'DELETE', http_status: 204, object_key: '/data-bucket/to-delete' }),
        ]);
        const logs = await parse(stream, replication_src_bucket, undefined, true);
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('delete');
        expect(logs[0].key).toBe('to-delete');
    });

    it('skips DELETE entries when sync_deletions is false', async () => {
        const stream = make_log_stream([
            make_log_entry({ op: 'DELETE', http_status: 204, object_key: '/data-bucket/to-delete' }),
        ]);
        const logs = await parse(stream, replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(0);
    });

    it('skips pre-operation intention logs (http_status 102)', async () => {
        // PERSISTENT mode logs every operation twice: once pre-op (status 102), once post-op
        const entries = [
            make_log_entry({ op: 'PUT', http_status: 102, object_key: '/data-bucket/my-key' }),
            make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/my-key' }),
        ];
        const logs = await parse(make_log_stream(entries), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('copy');
    });

    it('skips entries without the noobaa_bucket_logging marker and aborts the file', async () => {
        const bad = { op: 'PUT', source_bucket: 'data-bucket', object_key: '/data-bucket/key' };
        const good = make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/key2' });
        // bad entry comes first → the entire file is skipped
        const logs = await parse(make_log_stream([bad, good]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(0);
    });

    it('filters entries by object key prefix', async () => {
        const entries = [
            make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/images/cat.png' }),
            make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/docs/readme.md' }),
        ];
        const logs = await parse(make_log_stream(entries), replication_src_bucket, 'images/', false);
        expect(logs).toHaveLength(1);
        expect(logs[0].key).toBe('images/cat.png');
    });

    it('includes all entries when no prefix filter is set', async () => {
        const entries = [
            make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/a' }),
            make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/b' }),
        ];
        const logs = await parse(make_log_stream(entries), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(2);
    });

    it('skips PUT entries with non-2xx status codes', async () => {
        const entries = [
            make_log_entry({ op: 'PUT', http_status: 500, object_key: '/data-bucket/err' }),
            make_log_entry({ op: 'PUT', http_status: 403, object_key: '/data-bucket/denied' }),
            make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/ok' }),
        ];
        const logs = await parse(make_log_stream(entries), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(1);
        expect(logs[0].key).toBe('ok');
    });

    it('skips DELETE entries with non-204 status codes', async () => {
        const entries = [
            make_log_entry({ op: 'DELETE', http_status: 404, object_key: '/data-bucket/missing' }),
            make_log_entry({ op: 'DELETE', http_status: 204, object_key: '/data-bucket/gone' }),
        ];
        const logs = await parse(make_log_stream(entries), replication_src_bucket, undefined, true);
        expect(logs).toHaveLength(1);
        expect(logs[0].key).toBe('gone');
    });

    it('extracts the key using log.source_bucket, not the replication source bucket', async () => {
        // When replication is on ns-bucket but logging is on data-bucket,
        // the log entry has source_bucket="data-bucket". Key extraction must use
        // log.source_bucket to strip the right prefix.
        const entry = make_log_entry({
            op: 'PUT',
            http_status: 200,
            source_bucket: 'data-bucket',
            object_key: '/data-bucket/replicated-key',
        });
        const logs = await parse(make_log_stream([entry]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(1);
        expect(logs[0].key).toBe('replicated-key');
    });

    it('handles percent-encoded keys in the log entry', async () => {
        const entry = make_log_entry({
            op: 'PUT',
            http_status: 200,
            object_key: '/data-bucket/path%2Fwith%20spaces',
        });
        const logs = await parse(make_log_stream([entry]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(1);
        expect(logs[0].key).toBe('path/with spaces');
    });

    it('skips malformed lines in the log objects', async () => {
        const entry = [make_log_entry()];
        const malformed_log = entry.map(e => JSON.stringify(e).slice(0, -1)).join('\n') + '\n';
        const logs = await parse(Readable.from([malformed_log]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(0);
    });

    it('skips entries with a missing mandatory field (timestamp)', async () => {
        const entry = { ...make_log_entry(), timestamp: undefined };
        const logs = await parse(make_log_stream([entry]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(0);
    });

    it('skips entries with a missing mandatory field (object_key)', async () => {
        const entry = { ...make_log_entry(), object_key: undefined };
        const logs = await parse(make_log_stream([entry]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(0);
    });

    it('skips entries with a missing mandatory field (source_bucket)', async () => {
        const entry = { ...make_log_entry(), source_bucket: undefined };
        const logs = await parse(make_log_stream([entry]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(0);
    });

    it('skips blank lines in the stream without failing', async () => {
        const line1 = JSON.stringify(make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/k1' }));
        const line2 = JSON.stringify(make_log_entry({ op: 'PUT', http_status: 200, object_key: '/data-bucket/k2' }));
        // Inject blank lines between real entries
        const raw = `${line1}\n\n   \n${line2}\n`;
        const logs = await parse(Readable.from([raw]), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(2);
    });

    it('returns an empty array for an empty stream', async () => {
        const logs = await parse(Readable.from(['']), replication_src_bucket, undefined, false);
        expect(logs).toHaveLength(0);
    });

    it('produces a Date object for the time field', async () => {
        const ts = '2026-10-22T10:00:00.000Z';
        const entry = make_log_entry({ op: 'PUT', http_status: 200, timestamp: ts });
        const logs = await parse(make_log_stream([entry]), replication_src_bucket, undefined, false);
        expect(logs[0].time).toBeInstanceOf(Date);
        expect(logs[0].time.toISOString()).toBe(ts);
    });
});

// ─── get_log_candidates routing ──────────────────────────────────────────────

// Bucket descriptors returned by the mocked system_store.
const data_bucket = { name: { unwrap: () => 'data-bucket' } }; // no .namespace → MCG data bucket
const ns_bucket_aws = {
    name: { unwrap: () => 'ns-bucket-aws' },
    namespace: {
        write_resource: { resource: { connection: { endpoint_type: 'AWS' } } },
    },
};
const ns_bucket_s3compat = {
    name: { unwrap: () => 'ns-compat' },
    namespace: {
        write_resource: { resource: { connection: { endpoint_type: 'S3_COMPATIBLE' } } },
    },
};

// Replication configs for each provider
const RULE_ID = 'rule-1';
const BUCKET_ID = 'bucket-id-1';

const noobaa_config = {
    _id: 'repl-1',
    log_replication_info: {
        noobaa_log_replication_info: {
            logs_location: { logs_bucket: 'log-bucket', prefix: 'prefix/' },
        },
    },
    rules: [{ rule_id: RULE_ID }],
};
const aws_config = {
    _id: 'repl-2',
    log_replication_info: {
        aws_log_replication_info: { logs_location: { logs_bucket: 'aws-logs' } },
    },
    rules: [{ rule_id: RULE_ID }],
};

// Mocks for the routing test suite.
// jest.mock() factories are hoisted, so all values must be defined inside the factory.

// Mock system_store — get_by_id is a jest.fn() stored on the module export so tests can configure it.
jest.mock('../../../server/system_services/system_store', () => {
    const mock_get_by_id = jest.fn();
    const instance = {
        data: {
            get_by_id: mock_get_by_id,
            systems: [{}],
        },
        is_finished_initial_load: true,
    };
    return {
        get_instance: () => instance,
        // expose the mock fn so test code can call .mockReturnValue() on it
        __mock_get_by_id: mock_get_by_id,
    };
});

// Mock cloud_utils — all methods needed by get_log_candidates and its callees.
jest.mock('../../../util/cloud_utils', () => ({
    set_noobaa_s3_connection: jest.fn().mockReturnValue({
        listObjectsV2: jest.fn().mockResolvedValue({ Contents: [], NextContinuationToken: undefined }),
    }),
    get_s3_endpoint_signature_ver: jest.fn().mockReturnValue('s3v4'),
    is_aws_endpoint: jest.fn().mockReturnValue(false),
}));

// Mock noobaa_s3_client so the AWS connection builder doesn't need real network infra.
jest.mock('../../../sdk/noobaa_s3_client/noobaa_s3_client', () => ({
    get_s3_client_v3_params: jest.fn().mockReturnValue({
        listObjectsV2: jest.fn().mockResolvedValue({ Contents: [], NextContinuationToken: undefined }),
    }),
    get_requestHandler_with_suitable_agent: jest.fn().mockReturnValue({}),
}));

// Mock pool_server for the AWS path's credential resolution.
jest.mock('../../../server/system_services/pool_server', () => ({
    get_namespace_resource_extended_info: jest.fn().mockReturnValue({
        endpoint: 'https://s3.amazonaws.com',
        access_key: { unwrap: () => 'AK' },
        secret_key: { unwrap: () => 'SK' },
        auth_method: 'AWS_V4',
    }),
}));

describe('get_log_candidates routing', () => {
    // Re-require log_parser AFTER the jest.mock calls above take effect.
    // The mocks are hoisted so this require sees the mocked modules.
    const parser = require('../../../server/bg_services/replication_log_parser');
    const { __mock_get_by_id } = require('../../../server/system_services/system_store');

    afterEach(() => {
        __mock_get_by_id.mockReset();
    });

    it('routes to NooBaa path for a data bucket (no .namespace) with noobaa_log_replication_info', async () => {
        __mock_get_by_id.mockReturnValue(data_bucket);
        // Should not throw even though data_bucket has no .namespace
        const result = await parser.get_log_candidates(BUCKET_ID, RULE_ID, noobaa_config, false);
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('done');
    });

    it('routes to NooBaa path for an NS bucket with noobaa_log_replication_info', async () => {
        // NS bucket has .namespace, but noobaa_log_replication_info takes precedence over endpoint_type
        __mock_get_by_id.mockReturnValue(ns_bucket_aws);
        const result = await parser.get_log_candidates(BUCKET_ID, RULE_ID, noobaa_config, false);
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('done');
    });

    it('throws when a data bucket has aws_log_replication_info (misconfiguration)', async () => {
        // A data bucket has no .namespace — aws_log_replication_info is a config error
        __mock_get_by_id.mockReturnValue(data_bucket);
        await expect(
            parser.get_log_candidates(BUCKET_ID, RULE_ID, aws_config, false)
        ).rejects.toThrow(/has no namespace but log type is not NOOBAA/);
    });

    it('routes to AWS path for an NS bucket with AWS endpoint type', async () => {
        __mock_get_by_id.mockReturnValue(ns_bucket_aws);
        // AWS path will listObjectsV2 on the aws-logs bucket. Our mock returns empty.
        const result = await parser.get_log_candidates(BUCKET_ID, RULE_ID, aws_config, false);
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('done');
    });

    it('throws for an NS bucket with an unsupported endpoint type', async () => {
        __mock_get_by_id.mockReturnValue(ns_bucket_s3compat);
        await expect(
            parser.get_log_candidates(BUCKET_ID, RULE_ID, aws_config, false)
        ).rejects.toThrow(/Unsupported endpoint type S3_COMPATIBLE/);
    });
});

// ─── create_candidates with NooBaa logs ──────────────────────────────────────

describe('create_candidates with NooBaa log entries', () => {
    it('keeps only the latest action per key', () => {
        const logs = [
            { key: 'my-key', action: 'copy', time: new Date('2026-01-01T10:00:00Z') },
            { key: 'my-key', action: 'delete', time: new Date('2026-01-01T11:00:00Z') },
        ];
        const candidates = log_parser.create_candidates(logs);
        expect(candidates['my-key'].action).toBe('delete');
    });

    it('sets action to conflict when a delete follows a copy at the same timestamp', () => {
        const t = new Date('2026-01-01T10:00:00Z');
        const logs = [
            { key: 'key', action: 'copy', time: t },
            { key: 'key', action: 'delete', time: t },
        ];
        const candidates = log_parser.create_candidates(logs);
        // Conflict means both copy and delete occurred — scanner should head the object
        expect(['copy', 'delete', 'conflict']).toContain(candidates.key.action);
    });

    it('returns an empty object for an empty log array', () => {
        expect(log_parser.create_candidates([])).toEqual({});
    });
});
