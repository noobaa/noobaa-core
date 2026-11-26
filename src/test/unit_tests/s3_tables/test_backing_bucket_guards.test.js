/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

jest.mock('../../../server/notifications/dispatcher', () => ({
    instance: () => ({ activity: jest.fn(), alert: jest.fn() }),
}));
jest.mock('../../../server/object_services/md_store', () => ({
    MDStore: { instance: () => ({
        has_any_locked_objects_in_bucket: jest.fn(async () => false),
        has_any_completed_objects_in_bucket: jest.fn(async () => false),
    }) },
}));
jest.mock('../../../util/access_policy_utils', () => ({
    validate_bucket_policy: jest.fn(),
    normalize_bucket_policy_for_storage: async policy => policy,
}));
jest.mock('../../../server/system_services/replication_store', () => ({
    instance: () => ({
        mark_deleted_replication_by_id: jest.fn(),
        get_replication_rules: async () => [],
        insert_replication: async () => 'replication-id',
        update_replication: async () => 'replication-id',
    }),
}));

const config = require('../../../../config');
const SensitiveString = require('../../../util/sensitive_string');
const bucket_server = require('../../../server/system_services/bucket_server');
const system_store = require('../../../server/system_services/system_store').get_instance();
const BucketSpaceNB = require('../../../sdk/bucketspace_nb');
const ObjectSDK = require('../../../sdk/object_sdk');
const S3Error = require('../../../endpoint/s3/s3_errors').S3Error;
const _ = require('lodash');

const ss = value => new SensitiveString(value);
const NAME = 'analytics--table-s3-nb';
const OWNER = '012345678901234567890123';
const refused = [
    ['delete_bucket', {}],
    ['delete_bucket_and_objects', {}],
    ['set_bucket_lifecycle_configuration_rules', { rules: [] }],
    ['delete_bucket_lifecycle', {}],
    ['put_object_lock_configuration', { object_lock_configuration: { object_lock_enabled: 'Enabled' } }],
    ['put_bucket_replication', { replication_policy: { rules: [] } }],
    ['delete_bucket_replication', {}],
    ['put_bucket_encryption', { encryption: { algorithm: 'AES256' } }],
    ['delete_bucket_encryption', {}],
    ['put_bucket_policy', { policy: { Statement: [] } }],
    ['delete_bucket_policy', {}],
    ['put_bucket_website', { website: {} }],
    ['delete_bucket_website', {}],
    ['update_bucket', { versioning: 'ENABLED' }],
    ['update_bucket', { new_name: ss('renamed') }],
    ['update_buckets', { versioning: 'ENABLED' }],
    ['update_buckets', { new_name: ss('renamed') }],
];

let bucket;
let req;
let write;
let sdk;

beforeEach(() => {
    bucket = { _id: 'bucket-id', name: ss(NAME), table_bucket: OWNER, versioning: 'DISABLED' };
    req = {
        rpc_params: { name: ss(NAME) },
        system: { _id: 'system-id', buckets_by_name: { [NAME]: bucket } },
        account: { email: ss('owner@example.com') },
        load_auth: jest.fn(),
    };
    write = jest.spyOn(system_store, 'make_changes').mockResolvedValue();
    // Use the production S3 -> ObjectSDK -> BucketSpaceNB -> bucket RPC chain.
    // The transport is in-process; only persistence is mocked.
    const rpc_client = { bucket: {} };
    const base_req = req;
    for (const method of Object.keys(bucket_server)) {
        rpc_client.bucket[method] = async params => bucket_server[method]({
            ...base_req, rpc_params: { ...params, name: ss(String(params.name)) },
        });
    }
    const bs = new BucketSpaceNB({ rpc_client });
    sdk = Object.create(ObjectSDK.prototype);
    sdk._get_bucketspace = () => bs;
    sdk._get_bucket_namespace = async () => ({});
    sdk.read_bucket_sdk_namespace_info = async () => ({});
    sdk.read_bucket = async () => ({ versioning: bucket.versioning });
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => require('fs').unwatchFile(require('path').join(config.NSFS_NC_CONF_DIR, 'config.json')));

describe.each([true, false])('backing bucket guards, S3_TABLES_ENABLED=%s', enabled => {
    let previous;
    beforeEach(() => {
        previous = config.S3_TABLES_ENABLED;
        config.S3_TABLES_ENABLED = enabled;
    });
    afterEach(() => { config.S3_TABLES_ENABLED = previous; });

    test.each(['update_bucket', 'update_buckets'])('%s refuses renaming an ordinary bucket into the reserved suffix', async method => {
        delete bucket.table_bucket;
        bucket.name = ss('analytics');
        req.system.buckets_by_name = { analytics: bucket };
        const before = _.cloneDeep(bucket);
        const update = { name: bucket.name, new_name: ss(NAME) };
        req.rpc_params = method === 'update_buckets' ? [update] : update;
        await expect(bucket_server[method](req)).rejects.toMatchObject({ rpc_code: 'INVALID_BUCKET_NAME' });
        expect(bucket).toEqual(before);
        expect(write).not.toHaveBeenCalled();
    });

    test.each(['update_bucket', 'update_buckets'])('%s allows a rename with the reserved text before the end', async method => {
        delete bucket.table_bucket;
        const update = { name: bucket.name, new_name: ss('analytics--table-s3-nb-archive') };
        req.rpc_params = method === 'update_buckets' ? [update] : update;
        await bucket_server[method](req);
        expect(write).toHaveBeenCalledWith(expect.objectContaining({ update: { buckets: [{
            _id: bucket._id, name: update.new_name,
        }] } }));
    });

    test('bulk rename into the reserved suffix rejects the entire batch', async () => {
        delete bucket.table_bucket;
        const ordinary = { _id: 'ordinary-id', name: ss('ordinary') };
        req.system.buckets_by_name.ordinary = ordinary;
        req.rpc_params = [
            { name: ordinary.name, new_name: ss('allowed-name') },
            { name: bucket.name, new_name: ss('reserved--table-s3-nb') },
        ];
        await expect(bucket_server.update_buckets(req)).rejects.toMatchObject({ rpc_code: 'INVALID_BUCKET_NAME' });
        expect(write).not.toHaveBeenCalled();
    });

    test.each(refused)('management RPC %s refuses before any write (%j)', async (method, params) => {
        const before = _.cloneDeep(bucket);
        req.rpc_params = method === 'update_buckets' ? [{ name: ss(NAME), ...params }] : { name: ss(NAME), ...params };
        await expect(bucket_server[method](req)).rejects.toMatchObject({ rpc_code: 'UNAUTHORIZED' });
        expect(bucket).toEqual(before);
        expect(write).not.toHaveBeenCalled();
    });

    const s3_cases = [
        ['delete_bucket', {}],
        ['put_bucket_versioning', { VersioningConfiguration: { Status: ['Enabled'] } }],
        ['put_bucket_lifecycle', { LifecycleConfiguration: { Rule: [{ ID: ['expire'], Status: ['Enabled'], Expiration: [{ Days: ['1'] }] }] } }],
        ['delete_bucket_lifecycle', {}],
        ['put_bucket_object_lock', { ObjectLockConfiguration: { ObjectLockEnabled: ['Enabled'] } }],
        ['put_bucket_encryption', { ServerSideEncryptionConfiguration: { Rule: [{ ApplyServerSideEncryptionByDefault: [{ SSEAlgorithm: ['AES256'] }] }] } }],
        ['delete_bucket_encryption', {}],
        ['put_bucket_policy', { Statement: [] }],
        ['delete_bucket_policy', {}],
        ['put_bucket_website', { WebsiteConfiguration: { IndexDocument: [{ Suffix: ['index.html'] }] } }],
        ['delete_bucket_website', {}],
    ];
    test.each(s3_cases)('S3 handler %s reaches the guard (%j)', async (op, body) => {
        const handler = require(`../../../endpoint/s3/ops/s3_${op}`).handler;
        await expect(handler({ params: { bucket: NAME }, body, headers: {}, object_sdk: sdk }))
            .rejects.toMatchObject({ rpc_code: 'UNAUTHORIZED' });
        expect(write).not.toHaveBeenCalled();
    });

    test('S3 replication is already refused as unimplemented', async () => {
        const handler = require('../../../endpoint/s3/ops/s3_put_bucket_replication').handler;
        await expect(handler({ params: { bucket: NAME }, object_sdk: sdk }))
            .rejects.toMatchObject({ code: S3Error.NotImplemented.code });
        expect(write).not.toHaveBeenCalled();
    });

    test('reserved suffix cannot be used for ordinary CreateBucket, including S3', async () => {
        await expect(bucket_server.create_bucket(req)).rejects.toMatchObject({ rpc_code: 'INVALID_BUCKET_NAME' });
        const handler = require('../../../endpoint/s3/ops/s3_put_bucket').handler;
        await expect(handler({ params: { bucket: NAME }, headers: {}, object_sdk: sdk }, {}))
            .rejects.toMatchObject({ rpc_code: 'INVALID_BUCKET_NAME' });
        expect(write).not.toHaveBeenCalled();
    });
});

test('RPC internal_call and supplied marker cannot bypass deletion', async () => {
    req.rpc_params.internal_call = true;
    req.rpc_params.table_bucket = OWNER;
    await expect(bucket_server.delete_bucket(req)).rejects.toMatchObject({ rpc_code: 'UNAUTHORIZED' });
    await expect(bucket_server.delete_bucket_and_objects(req)).rejects.toMatchObject({ rpc_code: 'UNAUTHORIZED' });
    expect(write).not.toHaveBeenCalled();
});

test('only internal cleanup with the matching owner id can remove the backing bucket', async () => {
    await expect(bucket_server.delete_table_backing_bucket(req)).rejects.toMatchObject({ rpc_code: 'UNAUTHORIZED' });
    await expect(bucket_server.delete_table_backing_bucket(req, 'another-id')).rejects.toMatchObject({ rpc_code: 'UNAUTHORIZED' });
    expect(write).not.toHaveBeenCalled();
    await bucket_server.delete_table_backing_bucket(req, OWNER);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ update: { buckets: [expect.objectContaining({
        _id: bucket._id, $set: expect.objectContaining({ deleting: expect.any(Date) }),
    })] } }));
});

test('bulk update preflights all guards before collecting changes', async () => {
    const ordinary = { _id: 'ordinary', name: ss('ordinary') };
    req.system.buckets_by_name.ordinary = ordinary;
    req.rpc_params = [{ name: ordinary.name, new_name: ss('changed') }, { name: bucket.name, versioning: 'ENABLED' }];
    await expect(bucket_server.update_buckets(req)).rejects.toMatchObject({ rpc_code: 'UNAUTHORIZED' });
    expect(write).not.toHaveBeenCalled();
});

// A legacy suffix alone must never arm the guards.
test.each(refused.filter(([method]) => method !== 'delete_bucket'))(
    'unmarked legacy bucket permits %s (%j)', async (method, params) => {
        delete bucket.table_bucket;
        bucket.versioning = 'ENABLED';
        bucket.replication_policy_id = 'replication-id';
        req.rpc_params = method === 'update_buckets' ? [{ name: bucket.name, ...params }] : { name: bucket.name, ...params };
        if (method === 'put_bucket_replication') {
            req.system.buckets_by_name.destination = { _id: 'destination-id' };
            req.rpc_params.replication_policy.rules = [{ rule_id: 'rule', destination_bucket: ss('destination') }];
        }
        await bucket_server[method](req);
        expect(write).toHaveBeenCalled();
    }
);

test.each([
    ['put_bucket_tagging', { tagging: [] }],
    ['put_bucket_notification', { notifications: [] }],
    ['put_bucket_cors', { cors_rules: [] }],
    ['put_public_access_block', { public_access_block: {} }],
    ['delete_public_access_block', {}],
    ['update_bucket', { new_tag: 'allowed' }],
])('marked bucket still permits %s', async (method, params) => {
    req.rpc_params = { name: bucket.name, ...params };
    await bucket_server[method](req);
    expect(write).toHaveBeenCalled();
});


test('ordinary empty bucket deletion still removes the bucket record', async () => {
    delete bucket.table_bucket;
    const tier_server = require('../../../server/system_services/tier_server');
    jest.spyOn(tier_server, 'get_associated_buckets').mockReturnValue([]);
    const stats = require('../../../server/analytic_services/bucket_stats_store').BucketStatsStore;
    jest.spyOn(stats, 'instance').mockReturnValue({ delete_stats: jest.fn() });
    const server_rpc = require('../../../server/server_rpc');
    jest.replaceProperty(server_rpc, 'client', { object: { delete_quota_usage: jest.fn() } });
    await bucket_server.delete_bucket(req);
    expect(write).toHaveBeenCalledWith({ remove: { buckets: [bucket._id], tieringpolicies: [], tiers: [] } });
});

test('internal deletion helper is absent from the public RPC schema', () => {
    const api = require('../../../api/bucket_api');
    expect(api.methods.delete_table_backing_bucket).toBeUndefined();
});

test.each([true, false])('object I/O and multipart remain usable with S3_TABLES_ENABLED=%s', async enabled => {
    const previous = config.S3_TABLES_ENABLED;
    config.S3_TABLES_ENABLED = enabled;
    try {
        const ns = sdk._setup_bucket_namespace(bucket).ns;
        sdk._get_bucket_namespace = async () => ns;
        const methods = ['list_objects', 'read_object_md', 'delete_object', 'delete_multiple_objects',
            'create_object_upload', 'list_multiparts', 'complete_object_upload', 'abort_object_upload'];
        sdk.rpc_client = { object: Object.fromEntries(methods.map(method => [method, jest.fn(async () => ({ ok: true }))])) };
        sdk.object_io = {
            upload_object: jest.fn(async () => ({ etag: 'etag' })),
            read_object_stream: jest.fn(async () => Buffer.from('table data')),
            upload_multipart: jest.fn(async () => ({ etag: 'part-etag' })),
        };
        const params = { bucket: NAME, key: 'table-id/data/file', obj_id: OWNER };
        await expect(sdk.upload_object({ ...params })).resolves.toEqual({ etag: 'etag' });
        await expect(sdk.read_object_stream({ ...params })).resolves.toEqual(Buffer.from('table data'));
        await expect(sdk.upload_multipart({ ...params })).resolves.toEqual({ etag: 'part-etag' });
        for (const method of methods) {
            await expect(sdk[method]({ ...params })).resolves.toEqual({ ok: true });
            expect(sdk.rpc_client.object[method]).toHaveBeenCalledWith(expect.objectContaining({ bucket: NAME }));
        }
        expect(write).not.toHaveBeenCalled();
    } finally {
        config.S3_TABLES_ENABLED = previous;
    }
});
