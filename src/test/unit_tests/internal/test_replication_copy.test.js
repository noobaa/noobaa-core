/* Copyright (C) 2026 NooBaa */
'use strict';

// Covers replication_utils.copy_keys_diff - the single data-moving loop used by both copy paths:
//   - with { noobaa_con }: the endpoint RPC handler path (noobaa S3 connection / copyObject).
//   - with { object_sdk }: the consumer path (internal ObjectSDK / upload_object), used once
//                          replication moves to queue mode.
// Version-id rule (same for both paths): a key with a single version is copied as the current
// object (no versionId); a key with multiple versions is copied oldest-first, each by its versionId.

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

jest.mock('../../../util/debug_module', () => () => ({
    set_module_level: () => undefined,
    log0: () => undefined,
    log1: () => undefined,
    log2: () => undefined,
    warn: () => undefined,
    error: () => undefined,
}));
jest.mock('../../../server/system_services/replication_store', () => ({
    instance: () => ({ get_all_replication_configs: jest.fn() }),
}));
jest.mock('../../../server/analytic_services/prometheus_reporting', () => ({ get_core_report: () => ({}) }));
jest.mock('../../../server/system_services/system_store', () => ({ get_instance: () => ({ data: {} }) }));
// copy_keys_diff doesn't use auth_server; mock it so the real one (and the config file-watcher it
// loads) stays out of this unit test.
jest.mock('../../../server/common_services/auth_server', () => ({ make_auth_token: () => ({}) }));

const SensitiveString = require('../../../util/sensitive_string');
const u = require('../../../server/utils/replication_utils');

const SRC = new SensitiveString('src-bucket');
const DST = new SensitiveString('dst-bucket');

describe('replication_utils.copy_keys_diff via noobaa connection (endpoint path)', () => {

    const make_con = () => {
        const calls = [];
        return { calls, copyObject: jest.fn(async params => { calls.push(params); }) };
    };
    const copy = (con, keys_diff_map) => u.copy_keys_diff(SRC, DST, keys_diff_map, { noobaa_con: con });

    it('copies a single-version key as the current object (no versionId) and counts it', async () => {
        const con = make_con();
        const res = await copy(con, { key1: [{ Size: 7 }] });
        expect(con.copyObject).toHaveBeenCalledTimes(1);
        expect(con.calls[0]).toEqual({ Bucket: 'dst-bucket', CopySource: '/src-bucket/key1', Key: 'key1' });
        expect(res).toEqual({ num_of_objects: 1, size_of_objects: 7 });
    });

    it('omits the versionId for a single version even when it has a VersionId (length-based rule)', async () => {
        const con = make_con();
        await copy(con, { key1: [{ VersionId: 'v1', Size: 3 }] });
        expect(con.calls[0].CopySource).toBe('/src-bucket/key1');
    });

    it('prefers ContentLength over Size for sizing', async () => {
        const con = make_con();
        const res = await copy(con, { key1: [{ ContentLength: 10, Size: 999 }] });
        expect(res).toEqual({ num_of_objects: 1, size_of_objects: 10 });
    });

    it('copies the oldest version first for a multi-version key and sums sizes', async () => {
        const con = make_con();
        // ListObjectVersions returns newest first - the loop must replicate oldest first.
        const res = await copy(con, { key1: [
            { VersionId: 'v3', Size: 3 },
            { VersionId: 'v2', Size: 2 },
            { VersionId: 'v1', Size: 1 },
        ] });
        expect(con.calls.map(c => c.CopySource)).toEqual([
            '/src-bucket/key1?versionId=v1',
            '/src-bucket/key1?versionId=v2',
            '/src-bucket/key1?versionId=v3',
        ]);
        expect(res).toEqual({ num_of_objects: 3, size_of_objects: 6 });
    });

    it('url-encodes the source key', async () => {
        const con = make_con();
        await copy(con, { 'dir/my key': [{ Size: 1 }] });
        expect(con.calls[0].CopySource).toBe('/src-bucket/dir/my%20key');
    });

    it('swallows per-object copy errors and does not count failed objects', async () => {
        const con = make_con();
        con.copyObject.mockImplementation(async params => {
            if (params.Key === 'bad') throw new Error('boom');
            con.calls.push(params);
        });
        const res = await copy(con, { good: [{ Size: 4 }], bad: [{ Size: 5 }] });
        expect(res).toEqual({ num_of_objects: 1, size_of_objects: 4 });
    });

    it('returns zeros for an empty keys_diff_map', async () => {
        const con = make_con();
        const res = await copy(con, {});
        expect(con.copyObject).not.toHaveBeenCalled();
        expect(res).toEqual({ num_of_objects: 0, size_of_objects: 0 });
    });
});

describe('replication_utils.copy_keys_diff via object sdk (consumer path)', () => {

    const make_sdk = () => {
        const calls = [];
        return { calls, upload_object: jest.fn(async params => { calls.push(params); }) };
    };
    const copy = (sdk, keys_diff_map) => u.copy_keys_diff(SRC, DST, keys_diff_map, { object_sdk: sdk });

    it('uploads via copy_source without version_id for a single version', async () => {
        const sdk = make_sdk();
        const res = await copy(sdk, { key1: [{ Size: 7 }] });
        expect(sdk.calls[0]).toEqual({
            bucket: 'dst-bucket',
            key: 'key1',
            copy_source: { bucket: 'src-bucket', key: 'key1' },
            xattr_copy: true,
            tagging_copy: true,
        });
        expect(res).toEqual({ num_of_objects: 1, size_of_objects: 7 });
    });

    // ObjectSDK.upload_object copies the source xattr/content_encoding only when xattr_copy is set
    // and copies tags only when tagging_copy is set. The endpoint copyObject path copies metadata and
    // tags by default (S3 CopyObject COPY directive), so the consumer path must set both flags to
    // produce an identical replica. See replication_utils.copy_single_object.
    it('sets xattr_copy and tagging_copy so metadata and tags are copied like the endpoint path', async () => {
        const sdk = make_sdk();
        await copy(sdk, { key1: [{ Size: 7 }] });
        expect(sdk.calls[0].xattr_copy).toBe(true);
        expect(sdk.calls[0].tagging_copy).toBe(true);
    });

    it('sets xattr_copy and tagging_copy on every version of a multi-version key', async () => {
        const sdk = make_sdk();
        await copy(sdk, { key1: [
            { VersionId: 'v2', Size: 2 },
            { VersionId: 'v1', Size: 1 },
        ] });
        expect(sdk.calls).toHaveLength(2);
        for (const call of sdk.calls) {
            expect(call.xattr_copy).toBe(true);
            expect(call.tagging_copy).toBe(true);
        }
    });

    it('omits version_id for a single version even when it has a VersionId (length-based rule)', async () => {
        const sdk = make_sdk();
        await copy(sdk, { key1: [{ VersionId: 'v1', Size: 3 }] });
        expect(sdk.calls[0].copy_source).toEqual({ bucket: 'src-bucket', key: 'key1' });
    });

    it('includes version_id in copy_source and copies oldest version first', async () => {
        const sdk = make_sdk();
        const res = await copy(sdk, { key1: [
            { VersionId: 'v3', Size: 3 },
            { VersionId: 'v2', Size: 2 },
            { VersionId: 'v1', Size: 1 },
        ] });
        expect(sdk.calls.map(c => c.copy_source.version_id)).toEqual(['v1', 'v2', 'v3']);
        expect(res).toEqual({ num_of_objects: 3, size_of_objects: 6 });
    });

    it('prefers ContentLength, falls back to Size, then 0', async () => {
        const sdk = make_sdk();
        const res = await copy(sdk, {
            a: [{ ContentLength: 10, Size: 999 }],
            b: [{ Size: 5 }],
            c: [{}],
        });
        expect(res).toEqual({ num_of_objects: 3, size_of_objects: 15 });
    });

    it('swallows per-object upload errors and does not count failed objects', async () => {
        const sdk = make_sdk();
        sdk.upload_object.mockImplementation(async params => {
            if (params.key === 'bad') throw new Error('boom');
            sdk.calls.push(params);
        });
        const res = await copy(sdk, { good: [{ Size: 4 }], bad: [{ Size: 5 }] });
        expect(res).toEqual({ num_of_objects: 1, size_of_objects: 4 });
    });
});

describe('replication_utils.copy_keys_diff argument validation', () => {
    it('throws when neither noobaa_con nor object_sdk is provided', async () => {
        await expect(u.copy_keys_diff(SRC, DST, { key1: [{ Size: 1 }] }, {}))
            .rejects.toThrow(/noobaa_con or object_sdk/);
    });
});
