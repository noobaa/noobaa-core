/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * RestoreObject integration tests (owner, repeat restore, cross-account, bucket policy).
 *
 * Containerized coretest hosts the user bucket (archive_policy + MSC). A standalone
 * NC nsfs archive target (see nc_archive_target.js, same pattern as nc_coretest) provides
 * the deep-archive S3 target — not loopback to coretest, which returns NotImplemented
 * on archive payload RestoreObject.
 */

const coretest = require('../../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../../config');
const s3_utils = require('../../../../endpoint/s3/s3_utils');
const test_utils = require('../../../system_tests/test_utils');
const { err_code, generate_s3_policy, generate_s3_client } = test_utils;
const { start_nc_archive_target, stop_nc_archive_target } = require('../../../utils/nc_archive_target');

const { rpc_client } = coretest;

const NC_ARCHIVE_TARGET_BUCKET = 'test-restore-archive-target';
const ARCHIVE_CONNECTION = 'restore_nc_archive_connection';
const ARCHIVE_NSR = 'restore_nc_archive_nsr';

const RESTORE_BKT = 'test-restore-object';
const RESTORE_OWNER = 'restore-owner';
const RESTORE_PRINCIPAL = 'restore-principal';
const RESTORE_KEY_1 = 'restore/object-1';
const RESTORE_KEY_2 = 'restore/object-2';
const RESTORE_KEY_DUP = 'restore/duplicate-object';
const RESTORE_BODY_1 = Buffer.from('restore-payload-1');
const RESTORE_BODY_2 = Buffer.from('restore-payload-2');
const RESTORE_BODY_DUP = Buffer.from('restore-payload-dup');
const RESTORE_DAYS = 5;

mocha.describe('restore_object', function() {
    // Skip test if DB is not PostgreSQL
    if (config.DB_TYPE !== 'postgres') return;

    /** @type {import('@aws-sdk/client-s3').S3} */
    let s3_nc_archive;
    /** @type {import('@aws-sdk/client-s3').S3} */
    let s3_restore_owner;
    /** @type {import('@aws-sdk/client-s3').S3} */
    let s3_restore_principal;
    /** @type {string} */
    let restore_principal_id;
    /** @type {{ endpoint: string, access_key: string, secret_key: string }} */
    let archive_target;
    /** @type {boolean} */
    let original_archive_target_check_enabled;
    /** @type {boolean} */
    let original_archive_policy_check_enabled;
    let archive_connection_created = false;
    let archive_nsr_created = false;
    let restore_bucket_created = false;
    let nc_archive_target_bucket_created = false;
    let archive_config_overrides_applied = false;

    mocha.before(async function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this

        original_archive_target_check_enabled = config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED;
        original_archive_policy_check_enabled = config.ARCHIVE_POLICY_STORAGE_CLASS_CHECK_ENABLED;
        config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = false;
        config.ARCHIVE_POLICY_STORAGE_CLASS_CHECK_ENABLED = false;
        archive_config_overrides_applied = true;

        // Standalone NC nsfs endpoint used as the deep-archive S3 target.
        archive_target = await start_nc_archive_target();
        s3_nc_archive = generate_s3_client(archive_target.access_key, archive_target.secret_key, archive_target.endpoint);
        await s3_nc_archive.createBucket({ Bucket: NC_ARCHIVE_TARGET_BUCKET });
        nc_archive_target_bucket_created = true;

        // Containerized NooBaa: accounts, archive NSR → NC archive target, MSC restore bucket.
        const owner_details = await create_restore_test_account(RESTORE_OWNER);
        const principal_details = await create_restore_test_account(RESTORE_PRINCIPAL);
        restore_principal_id = principal_details.id.toString();

        const coretest_endpoint = coretest.get_http_address();
        s3_restore_owner = generate_s3_client(
            owner_details.access_keys[0].access_key.unwrap(),
            owner_details.access_keys[0].secret_key.unwrap(),
            coretest_endpoint
        );
        s3_restore_principal = generate_s3_client(
            principal_details.access_keys[0].access_key.unwrap(),
            principal_details.access_keys[0].secret_key.unwrap(),
            coretest_endpoint
        );

        await rpc_client.account.add_external_connection({
            name: ARCHIVE_CONNECTION,
            endpoint: archive_target.endpoint,
            endpoint_type: 'S3_COMPATIBLE',
            auth_method: 'AWS_V4',
            identity: archive_target.access_key,
            secret: archive_target.secret_key,
        });
        archive_connection_created = true;
        await rpc_client.pool.create_namespace_resource({
            name: ARCHIVE_NSR,
            connection: ARCHIVE_CONNECTION,
            target_bucket: NC_ARCHIVE_TARGET_BUCKET,
            archive: true,
        });
        archive_nsr_created = true;

        // owner creates the bucket (needed for cross-account restore/policy tests)
        await s3_restore_owner.createBucket({ Bucket: RESTORE_BKT });
        restore_bucket_created = true;
        // admin sets archive_policy (not available via S3 CreateBucket)
        await rpc_client.bucket.update_bucket({ name: RESTORE_BKT, archive_policy: { deep_archive_resource: { resource: ARCHIVE_NSR } }});

        await put_restore_deep_archive_object(s3_restore_owner, RESTORE_KEY_1, RESTORE_BODY_1);
        await put_restore_deep_archive_object(s3_restore_owner, RESTORE_KEY_2, RESTORE_BODY_2);
        await put_restore_deep_archive_object(s3_restore_owner, RESTORE_KEY_DUP, RESTORE_BODY_DUP);
    });

    mocha.after(async function() {
        try {
            if (restore_bucket_created) {
                await test_utils.empty_and_delete_buckets(rpc_client, [RESTORE_BKT]);
            }
            if (archive_nsr_created) {
                await rpc_client.pool.delete_namespace_resource({ name: ARCHIVE_NSR });
            }
            if (archive_connection_created) {
                await rpc_client.account.delete_external_connection({ connection_name: ARCHIVE_CONNECTION });
            }
            if (s3_nc_archive && nc_archive_target_bucket_created) {
                const listed = await s3_nc_archive.listObjectsV2({ Bucket: NC_ARCHIVE_TARGET_BUCKET });
                if (listed.Contents?.length) {
                    await s3_nc_archive.deleteObjects({
                        Bucket: NC_ARCHIVE_TARGET_BUCKET,
                        Delete: {
                            Objects: listed.Contents.map(obj => ({ Key: obj.Key })),
                        },
                    });
                }
                await s3_nc_archive.deleteBucket({ Bucket: NC_ARCHIVE_TARGET_BUCKET });
            }
        } catch (err) {
            console.warn('restore_object: cleanup:', err);
        } finally {
            await stop_nc_archive_target();
            if (archive_config_overrides_applied) {
                config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = original_archive_target_check_enabled;
                config.ARCHIVE_POLICY_STORAGE_CLASS_CHECK_ENABLED = original_archive_policy_check_enabled;
                archive_config_overrides_applied = false;
            }
        }
    });

    mocha.it('owner can restore a deep-archive object', async function() {
        const restore_res = await s3_restore_owner.restoreObject({
            Bucket: RESTORE_BKT,
            Key: RESTORE_KEY_1,
            RestoreRequest: { Days: RESTORE_DAYS },
        });
        assert.strictEqual(restore_res.$metadata.httpStatusCode, 202);

        const md = await rpc_client.object.read_object_md({ bucket: RESTORE_BKT, key: RESTORE_KEY_1 });
        assert.strictEqual(md.restore_status?.ongoing, true);
    });

    mocha.it('owner gets RestoreAlreadyInProgress on a second restore of the same object', async function() {
        const restore_res = await s3_restore_owner.restoreObject({
            Bucket: RESTORE_BKT,
            Key: RESTORE_KEY_DUP,
            RestoreRequest: { Days: RESTORE_DAYS },
        });
        assert.strictEqual(restore_res.$metadata.httpStatusCode, 202);

        await assert.rejects(
            s3_restore_owner.restoreObject({
                Bucket: RESTORE_BKT,
                Key: RESTORE_KEY_DUP,
                RestoreRequest: { Days: RESTORE_DAYS },
            }),
            err => err_code(err) === 'RestoreAlreadyInProgress'
        );
    });

    mocha.it('another account is denied RestoreObject without bucket policy', async function() {
        await assert.rejects(
            s3_restore_principal.restoreObject({
                Bucket: RESTORE_BKT,
                Key: RESTORE_KEY_2,
                RestoreRequest: { Days: RESTORE_DAYS },
            }),
            err => err_code(err) === 'AccessDenied'
        );
    });

    mocha.it('another account can restore with bucket policy granting s3:RestoreObject', async function() {
        const policy = generate_s3_policy(
            restore_principal_id,
            RESTORE_BKT,
            ['s3:RestoreObject'],
        ).policy;
        await s3_restore_owner.putBucketPolicy({
            Bucket: RESTORE_BKT,
            Policy: JSON.stringify(policy),
        });

        const restore_res = await s3_restore_principal.restoreObject({
            Bucket: RESTORE_BKT,
            Key: RESTORE_KEY_2,
            RestoreRequest: { Days: RESTORE_DAYS },
        });
        assert.strictEqual(restore_res.$metadata.httpStatusCode, 202);

        const md = await rpc_client.object.read_object_md({ bucket: RESTORE_BKT, key: RESTORE_KEY_2 });
        assert.strictEqual(md.restore_status?.ongoing, true);
    });
});

/**
 * @param {string} name
 * @returns {Promise<{
 *   id: import('../../../../sdk/nb').ID,
 *   arn: string,
 *   token: string,
 *   access_keys: Array<{
 *     access_key: import('../../../../sdk/nb').SensitiveString,
 *     secret_key: import('../../../../sdk/nb').SensitiveString,
 *   }>,
 * }>}
 */
async function create_restore_test_account(name) {
    return rpc_client.account.create_account({
        name,
        email: name,
        has_login: false,
        s3_access: true,
        default_resource: coretest.POOL_LIST[1].name,
    });
}

/**
 * @param {import('@aws-sdk/client-s3').S3} s3_client
 * @param {string} key
 * @param {Buffer} body
 * @returns {Promise<import('@aws-sdk/client-s3').PutObjectCommandOutput>}
 */
async function put_restore_deep_archive_object(s3_client, key, body) {
    return s3_client.putObject({
        Bucket: RESTORE_BKT,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
        StorageClass: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
    });
}
