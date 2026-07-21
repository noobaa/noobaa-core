/* Copyright (C) 2024 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../config');
const pool_server = require('../../../server/system_services/pool_server');

const { rpc_client, EMAIL } = coretest;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make_nsr(id, archive_flag) {
    return {
        _id: id,
        name: 'nsr-' + id,
        archive: archive_flag,
        access_mode: 'READ_WRITE',
        system: {
            buckets_by_name: {},
            vector_buckets_by_name: {},
        },
    };
}

// ---------------------------------------------------------------------------
// get_namespace_resource_info – archive field exposure
// ---------------------------------------------------------------------------

mocha.describe('get_namespace_resource_info – archive field', function() {
    mocha.it('includes archive:true when the NSR has archive set to true', function() {
        const info = pool_server.get_namespace_resource_info(make_nsr('id-1', true));
        assert.strictEqual(info.archive, true);
    });

    mocha.it('includes archive:false when the NSR has archive set to false', function() {
        // archive:false is falsy but not undefined, so _.omitBy(_.isUndefined) preserves it
        const info = pool_server.get_namespace_resource_info(make_nsr('id-2', false));
        assert.strictEqual(info.archive, false);
    });

    mocha.it('omits archive when the NSR does not have the archive field', function() {
        const nsr = make_nsr('id-3', undefined);
        delete nsr.archive;
        const info = pool_server.get_namespace_resource_info(nsr);
        assert.strictEqual(info.archive, undefined);
    });
});

// ---------------------------------------------------------------------------
// archive_policy – create_bucket / update_bucket
// ---------------------------------------------------------------------------

mocha.describe('archive_policy', function() {
    this.timeout(60000); // eslint-disable-line no-invalid-this

    const ARCHIVE_CONNECTION = 'archive_policy_test_connection';
    const ARCHIVE_NSR = 'archive_policy_test_nsr';
    const NON_ARCHIVE_NSR = 'non_archive_policy_test_nsr';
    const ARCHIVE_TARGET_BUCKET = 'archive-policy-target-bucket';
    const NON_ARCHIVE_TARGET_BUCKET = 'non-archive-policy-target-bucket';
    const ARCHIVE_BUCKET = 'archive-policy-bucket';
    const NAMESPACE_BUCKET = 'archive-policy-ns-bucket';
    const UPDATE_ARCHIVE_BUCKET = 'update-archive-policy-bucket';

    const target_buckets = [ARCHIVE_TARGET_BUCKET, NON_ARCHIVE_TARGET_BUCKET];
    const namespace_resources = [
        { name: ARCHIVE_NSR, target_bucket: ARCHIVE_TARGET_BUCKET, archive: true },
        { name: NON_ARCHIVE_NSR, target_bucket: NON_ARCHIVE_TARGET_BUCKET },
    ];
    const buckets = [
        {
            name: ARCHIVE_BUCKET,
            archive_policy: { deep_archive_resource: { resource: ARCHIVE_NSR } },
        },
        {
            name: NAMESPACE_BUCKET,
            namespace: {
                read_resources: [{ resource: NON_ARCHIVE_NSR }],
                write_resource: { resource: NON_ARCHIVE_NSR },
            },
        },
        { name: UPDATE_ARCHIVE_BUCKET },
    ];

    mocha.before(async function() {
        config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = false;
        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        for (const name of target_buckets) {
            await rpc_client.bucket.create_bucket({ name });
        }
        await rpc_client.account.add_external_connection({
            name: ARCHIVE_CONNECTION,
            endpoint: coretest.get_http_address(),
            endpoint_type: 'S3_COMPATIBLE',
            auth_method: 'AWS_V4',
            identity: account_info.access_keys[0].access_key.unwrap(),
            secret: account_info.access_keys[0].secret_key.unwrap(),
        });
        for (const nsr of namespace_resources) {
            await rpc_client.pool.create_namespace_resource({
                ...nsr,
                connection: ARCHIVE_CONNECTION,
            });
        }
        for (const bucket of buckets) {
            await rpc_client.bucket.create_bucket(bucket);
        }
    });

    mocha.after(async function() {
        for (const bucket of buckets) {
            await rpc_client.bucket.delete_bucket({ name: bucket.name });
        }
        for (const nsr of namespace_resources) {
            await rpc_client.pool.delete_namespace_resource({ name: nsr.name });
        }
        await rpc_client.account.delete_external_connection({ connection_name: ARCHIVE_CONNECTION });
        for (const name of target_buckets) {
            await rpc_client.bucket.delete_bucket({ name });
        }
        config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = true;
    });

    mocha.it('should reject create_bucket when deep_archive_resource NSR does not exist', async function() {
        try {
            await rpc_client.bucket.create_bucket({
                name: 'archive-missing-nsr-bucket',
                archive_policy: {
                    deep_archive_resource: { resource: 'nonexistent-archive-nsr' },
                },
            });
            assert.fail('expected create_bucket to throw');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'INVALID_ARCHIVE_RESOURCE');
            assert.ok(err.message.includes('nonexistent-archive-nsr'));
        }
    });

    mocha.it('should reject create_bucket when NSR does not have archive:true', async function() {
        try {
            await rpc_client.bucket.create_bucket({
                name: 'archive-non-archive-nsr-bucket',
                archive_policy: {
                    deep_archive_resource: { resource: NON_ARCHIVE_NSR },
                },
            });
            assert.fail('expected create_bucket to throw');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'INVALID_ARCHIVE_RESOURCE');
            assert.ok(err.message.includes('archive:true'));
        }
    });

    mocha.it('should create bucket with archive_policy and expose it on read_bucket', async function() {
        const info = await rpc_client.bucket.read_bucket({ name: ARCHIVE_BUCKET });
        assert.ok(info.archive_policy);
        assert.strictEqual(info.archive_policy.deep_archive_resource.resource, ARCHIVE_NSR);
    });

    mocha.it('should reject create_bucket with both namespace and archive_policy', async function() {
        const nsr = { resource: NON_ARCHIVE_NSR };
        try {
            await rpc_client.bucket.create_bucket({
                name: 'ns-with-archive-bucket',
                namespace: {
                    read_resources: [nsr],
                    write_resource: nsr,
                },
                archive_policy: {
                    deep_archive_resource: { resource: ARCHIVE_NSR },
                },
            });
            assert.fail('expected create_bucket to throw');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'CANNOT_SET_ARCHIVE_POLICY_ON_NAMESPACE_BUCKET');
        }
    });

    mocha.it('should reject update_bucket archive_policy on a namespace bucket', async function() {
        try {
            await rpc_client.bucket.update_bucket({
                name: NAMESPACE_BUCKET,
                archive_policy: {
                    deep_archive_resource: { resource: ARCHIVE_NSR },
                },
            });
            assert.fail('expected update_bucket to throw');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'CANNOT_SET_ARCHIVE_POLICY_ON_NAMESPACE_BUCKET');
        }
    });

    mocha.it('should set and remove archive_policy via update_bucket on a placement bucket', async function() {
        await rpc_client.bucket.update_bucket({
            name: UPDATE_ARCHIVE_BUCKET,
            archive_policy: {
                deep_archive_resource: { resource: ARCHIVE_NSR },
            },
        });
        let info = await rpc_client.bucket.read_bucket({ name: UPDATE_ARCHIVE_BUCKET });
        assert.strictEqual(info.archive_policy.deep_archive_resource.resource, ARCHIVE_NSR);

        await rpc_client.bucket.update_bucket({
            name: UPDATE_ARCHIVE_BUCKET,
            remove_archive_policy: true,
        });
        info = await rpc_client.bucket.read_bucket({ name: UPDATE_ARCHIVE_BUCKET });
        assert.ok(!info.archive_policy);
    });
});
