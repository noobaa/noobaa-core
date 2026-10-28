/* Copyright (C) 2020 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const _ = require('lodash');
const P = require('../../../../util/promise');
const config = require('../../../../../config');
const coretest = require('../../../utils/coretest/coretest');
const { rpc_client, EMAIL } = coretest; //, PASSWORD, SYSTEM
const util = require('util');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const { S3 } = require('@aws-sdk/client-s3');
const http = require('http');
const cloud_utils = require('../../../../util/cloud_utils');
const { ReplicationScanner } = require('../../../../server/bg_services/replication_scanner');
const { LogReplicationScanner } = require('../../../../server/bg_services/log_replication_scanner');
const { get_object } = require('../../../system_tests/test_utils');

const db_client = require('../../../../util/db_client').instance();
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

mocha.describe('replication configuration validity tests', function() {
    const bucket1 = 'bucket1-br';
    const bucket2 = 'bucket2-br';
    const first_bucket = 'first.bucket';
    const buckets = [bucket1, bucket2];

    mocha.before('create buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.create_bucket({ name: bucket_name });
        }));
    });

    mocha.after('delete buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.delete_bucket({ name: bucket_name });
        }));
        await rpc_client.bucket.delete_bucket_replication({ name: first_bucket });
    });

    mocha.it('_put_replication - same dst bucket & no prefixes - should fail', async function() {
        await _put_replication(bucket1,
            [
                { rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false },
                { rule_id: 'rule-2', destination_bucket: first_bucket, sync_versions: false }
            ], true);
    });

    mocha.it('_put_replication - same dst bucket & 1 prefix - should fail ', async function() {
        await _put_replication(bucket1,
            [
                { rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'lala' } },
                { rule_id: 'rule-2', destination_bucket: first_bucket, sync_versions: false }
            ], true);
    });

    mocha.it('_put_replication - 2 replication rules same rule_id - should fail', async function() {
        await _put_replication(bucket1,
            [
                { rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false },
                { rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false }
            ], true);
    });

    mocha.it('_put_replication 1 - valid', async function() {
        await _put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false }], false);
    });


    mocha.it('_put_replication - same dst bucket & prefix is a prefix of prefix 1 - should fail', async function() {
        await _put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false, filter: { prefix: 'a' } },
            { rule_id: 'rule-2', destination_bucket: bucket1, sync_versions: false, filter: { prefix: '' } }
        ], true);
    });

    mocha.it('_put_replication - same dst bucket & prefix is a prefix of prefix 2 - should fail', async function() {
        await _put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false, filter: { prefix: 'a' } },
            { rule_id: 'rule-2', destination_bucket: bucket1, sync_versions: false, filter: { prefix: 'ab' } }
        ], true);
    });

    mocha.it('_put_replication - bidirectional replication for matching prefix - should fail', async function() {
        await _put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'ab' }}], false);
        await _put_replication(first_bucket, [{ rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false, filter: { prefix: 'ab' } }], true);
    });

    mocha.it('_put_replication - bidirectional replication for matching prefix subset 1 - should fail', async function() {
        await _put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'ab' }}], false);
        await _put_replication(first_bucket, [{ rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false, filter: { prefix: 'a' } }], true);
    });

    mocha.it('_put_replication - bidirectional replication for matching prefix subset 2 - should fail', async function() {
        await _put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'a' }}], false);
        await _put_replication(first_bucket, [{ rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false, filter: { prefix: 'ab' } }], true);
    });

    mocha.it('_put_replication - bidirectional replication for no prefix - should fail', async function() {
        await _put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'ab' }}], false);
        await _put_replication(first_bucket, [{ rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false }], true);
    });

    mocha.it('_put_replication 2 - valid', async function() {
        await _put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'a' } },
            { rule_id: 'rule-2', destination_bucket: bucket1, sync_versions: false, filter: { prefix: 'ba' } }
        ], false);
    });

    mocha.it('_put_replication 3 - valid', async function() {
        await _put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: bucket1, sync_versions: false, filter: { prefix: '' } },
            { rule_id: 'rule-2', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'ab' } }
        ], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });

        assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === bucket1 && res.rules[0].filter.prefix === '');
        assert.ok(res.rules[1].rule_id === 'rule-2' && res.rules[1].destination_bucket.unwrap() === first_bucket && res.rules[1].filter.prefix === 'ab');
    });

    mocha.it('_put_replication 4 - valid', async function() {
        await _put_replication(bucket1, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: '' } }
        ], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === first_bucket && res.rules[0].filter.prefix === '');
    });

    mocha.it('_put_replication 5 - valid', async function() {
        await _put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false }], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === first_bucket);
    });

    mocha.it('_put_replication - same rule_id - should fail ', async function() {
        await _put_replication(bucket1, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false, filter: { prefix: 'b' } },
            { rule_id: 'rule-1', destination_bucket: bucket2, sync_versions: false, filter: { prefix: 'a' } }
        ], true);
    });

    mocha.it('get_bucket_replication ', async function() {
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === first_bucket);
    });

    mocha.it('delete bucket replication ', async function() {
        await rpc_client.bucket.delete_bucket_replication({ name: bucket1 });
        try {
            await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
            assert.fail('found a replication policy on the bucket but it shouldn\'t');
        } catch (err) {
            assert.ok(err.rpc_code === 'NO_REPLICATION_ON_BUCKET');
        }
    });
});

mocha.describe('replication collection tests', function() {
    const bucket1 = 'br-col1';
    const bucket2 = 'br-col2';
    const bucket3 = 'br-col3';
    const first_bucket = 'first.bucket';
    const buckets = [bucket1, bucket2, bucket3];
    let replication_policy_id;
    // eslint-disable-next-line global-require
    const replication_store = require('../../../../server/system_services/replication_store').instance();

    mocha.before('create buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.create_bucket({ name: bucket_name });
        }));
    });

    mocha.after('delete buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            if (bucket_name === bucket3) return;
            await rpc_client.bucket.delete_bucket({ name: bucket_name });
        }));
        await rpc_client.bucket.delete_bucket_replication({ name: first_bucket });
    });

    mocha.it('_put_replication on both buckets 1', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await _put_replication(bucket_name, [{ rule_id: 'rule-1', destination_bucket: first_bucket, sync_versions: false }], false);
            const res = await rpc_client.bucket.get_bucket_replication({ name: bucket_name });
            assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === first_bucket);
        }));
    });

    mocha.it('delete bucket replication from bucket1', async function() {
        await rpc_client.bucket.delete_bucket_replication({ name: bucket1 });
        try {
            await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
            assert.fail(`get_bucket_replication succeeded but it should fail`);
        } catch (err) {
            assert.ok(err.rpc_code === 'NO_REPLICATION_ON_BUCKET');
        }
        const repl_buck2 = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });
        assert.ok(repl_buck2.rules[0].rule_id === 'rule-1' && repl_buck2.rules[0].destination_bucket.unwrap() === first_bucket);
        replication_policy_id = (await rpc_client.bucket.read_bucket({ name: bucket2 })).replication_policy_id;
        try {
            const replication = await replication_store.get_replication_by_id(replication_policy_id);
            assert.ok(replication);
        } catch (err) {
            assert.fail('could not found replication', err);
        }
    });

    mocha.it('delete bucket replication from bucket2 - check replication still exists in db', async function() {
        await rpc_client.bucket.delete_bucket_replication({ name: bucket2 });
        try {
            await rpc_client.bucket.get_bucket_replication({ name: bucket2 });
            assert.fail(`get_bucket_replication succeeded but it should fail`);
        } catch (err) {
            assert.ok(err.rpc_code === 'NO_REPLICATION_ON_BUCKET');
        }
        const replication = await replication_store.get_replication_by_id(replication_policy_id);
        assert.ok(!replication);
    });

    mocha.it('_put_replication on both buckets 2', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await _put_replication(bucket_name, [{ rule_id: 'rule-2', destination_bucket: first_bucket, sync_versions: false }], false);
            const res = await rpc_client.bucket.get_bucket_replication({ name: bucket_name });
            assert.ok(res.rules[0].rule_id === 'rule-2' && res.rules[0].destination_bucket.unwrap() === first_bucket);
        }));
    });

    mocha.it('update bucket replication of bucket1', async function() {
        await _put_replication(bucket1, [{ rule_id: 'rule-3', destination_bucket: first_bucket, sync_versions: false }], false);
        const repl_buck1 = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        const repl_buck2 = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });
        assert.ok(repl_buck1.rules[0].rule_id === 'rule-3');
        assert.ok(repl_buck2.rules[0].rule_id === 'rule-2');

        const repl1 = ((await rpc_client.bucket.read_bucket({ name: bucket1 })).replication_policy_id);
        const repl2 = ((await rpc_client.bucket.read_bucket({ name: bucket2 })).replication_policy_id);
        assert.ok(repl1 !== repl2);
    });

    mocha.it('update bucket replication of bucket2', async function() {
        await _put_replication(bucket2, [{ rule_id: 'rule-3', destination_bucket: first_bucket, sync_versions: false }], false);
        const repl_buck1 = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        const repl_buck2 = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });
        assert.ok(repl_buck1.rules[0].rule_id === 'rule-3');
        assert.ok(repl_buck2.rules[0].rule_id === 'rule-3');

        const repl1 = ((await rpc_client.bucket.read_bucket({ name: bucket1 })).replication_policy_id);
        const repl2 = ((await rpc_client.bucket.read_bucket({ name: bucket2 })).replication_policy_id);
        assert.ok(repl1 !== repl2);

        // replication should be deleted if no bucket uses it
        const replication = await replication_store.get_replication_by_id(replication_policy_id);
        assert.ok(!replication);
    });

    mocha.it('delete bucket3 - check that replication was delete from db ', async function() {
        const replication_id = ((await rpc_client.bucket.read_bucket({ name: bucket3 })).replication_policy_id);

        await rpc_client.bucket.delete_bucket({ name: bucket3 });
        const ans = await db_client.collection('replicationconfigs').findOne({ _id: db_client.parse_object_id(replication_id) });
        assert.ok(ans.deleted);
    });
});

mocha.describe('replication configuration bg worker tests', function() {
    // Skip test if DB is not PostgreSQL
    if (config.DB_TYPE !== 'postgres') return;

    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);
    const bucket1 = 'bucket1-br-bg';
    const bucket2 = 'bucket2-br-bg';
    const bucket3 = 'bucket3-br-bg';
    const bucket4 = 'bucket4-br-bg';
    const bucket_for_replications = 'bucket5-br-bg';
    const bucket_to_delete = 'bucket-to-delete';
    const buckets = [bucket1, bucket2, bucket_to_delete, bucket3, bucket4, bucket_for_replications];
    let uploaded_objects_count = 0;
    let uploaded_prefix_objects_count = 0;
    //const namespace_buckets = [];
    let s3_owner;
    let scanner;
    const s3_creds = {
        forcePathStyle: true,
        // signatureVersion is Deprecated in SDK v3
        //signatureVersion: 'v4',
        // automatically compute the MD5 checksums for of the request payload in SDKV3
        //computeChecksums: true,
        // s3DisableBodySigning renamed to applyChecksum but can be assigned in S3 object
        // s3DisableBodySigning: false,
        region: 'us-east-1',
        requestHandler: new NodeHttpHandler({
            httpsAgent: new http.Agent({ keepAlive: false })
        })
    };

    // Special character items to ensure encoding of URI works OK in the replication scanner
    const special_character_items = [
        'key1273-2__#$!@%!#__BED-END-1-Carton-13.jpeg',
        'key1278-1__4267%2524__BED-END-1-Carton-13.jpeg'
    ];

    mocha.before('init scanner & populate buckets', async function() {
        // create buckets
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.create_bucket({ name: bucket_name });
        }));
        const admin_account = await rpc_client.account.read_account({ email: EMAIL });
        const admin_keys = admin_account.access_keys;
        //await create_namespace_buckets(admin_account);

        s3_creds.credentials = {
            accessKeyId: admin_keys[0].access_key.unwrap(),
            secretAccessKey: admin_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_owner = new S3(s3_creds);
        // populate buckets
        for (let i = 0; i < 10; i++) {
            let key = `key${i}`;
            if (i % 2 === 0) {
                key = 'pref' + key;
                uploaded_prefix_objects_count += 1;
            }
            await put_object(s3_owner, bucket1, key);
            uploaded_objects_count += 1;
        }

        // Add special characters items with prefix to the bucket
        await Promise.all(special_character_items.map(item => put_object(s3_owner, bucket1, 'pref' + item)));
        uploaded_objects_count += special_character_items.length;

        // Add special characters items without prefix to the bucket
        await Promise.all(special_character_items.map(item => put_object(s3_owner, bucket1, item)));
        uploaded_objects_count += special_character_items.length;
        uploaded_prefix_objects_count += special_character_items.length;

        cloud_utils.set_noobaa_s3_connection = () => {
            console.log('setting connection to coretest endpoint and access key');
            return s3_owner;
        };
        // init scanner
        scanner = new ReplicationScanner({
            name: 'replication_scanner',
            client: rpc_client
        });
    });

    mocha.after('delete buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            if (bucket_name === bucket_to_delete) return;
            for (let i = 0; i < 10; i++) {
                let key = `key${i}`;
                if (i % 2 === 0) key = 'pref' + key;
                await delete_object(s3_owner, bucket_name, key);
            }
            await Promise.all(special_character_items.map(item => delete_object(s3_owner, bucket_name, 'pref' + item)));
            await Promise.all(special_character_items.map(item => delete_object(s3_owner, bucket_name, item)));
            await rpc_client.bucket.delete_bucket({ name: bucket_name });
        }));
    });

    mocha.it('run replication scanner and wait - no replication rule - nothing to upload', async function() {
        const res1 = await scanner.run_batch();
        console.log('waiting for replication objects no objects to upload', res1);
        await _list_objects_and_wait(s3_owner, bucket_for_replications, 0);
    });

    mocha.it('run replication scanner and delete bucket', async function() {
        await _put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket_to_delete, sync_versions: false, filter: { prefix: bucket1 } }], false);

        await rpc_client.bucket.delete_bucket({ name: bucket_to_delete });
        const res1 = await scanner.run_batch();
        // no error, just moving to the next cycle
        assert.deepStrictEqual(res1, 300000);
    });

    mocha.it('run replication scanner and wait - prefix - prefixed objects should be uploaded', async function() {
        await _put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket_for_replications, sync_versions: false, filter: { prefix: 'pref' } }], false);
        let res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix', res1);
        let contents = await _list_objects_and_wait(s3_owner, bucket_for_replications, uploaded_prefix_objects_count); //Check that the desired objects were replicated
        console.log('contents', contents);

        // delete object from dst
        await s3_owner.deleteObject({ Bucket: bucket_for_replications, Key: contents[0].Key });
        await _list_objects_and_wait(s3_owner, bucket_for_replications, uploaded_prefix_objects_count - 1); //Verify that one object was deleted
        // sync again
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix', res1);
        contents = await _list_objects_and_wait(s3_owner, bucket_for_replications, uploaded_prefix_objects_count); //Check that the delete object was replicate again
        const key1 = contents[0].Key;
        // override object in dst
        const dst_obj1 = await get_object(s3_owner, bucket_for_replications, key1);
        await s3_owner.putObject({ Bucket: bucket_for_replications, Key: key1, Body: 'lalalala' });
        const dst_obj2 = await get_object(s3_owner, bucket_for_replications, key1);
        console.log('objs override dst1', dst_obj1, dst_obj2);

        assert.deepStrictEqual(dst_obj2.body, 'lalalala'); // dst object was updated correctly
        assert.notDeepStrictEqual(dst_obj1.body, dst_obj2.body); // new dst object was updated and
        // now is diff from the original dst object

        // sync again - should not replicate since dst bucket is last modified
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix', res1);

        const dst_obj3 = await get_object(s3_owner, bucket_for_replications, key1);
        const src_obj = await get_object(s3_owner, bucket1, key1);
        console.log('objs override dst2', src_obj, dst_obj3);
        assert.notDeepStrictEqual(src_obj.body, dst_obj3.body); // object in src !== object in dst
        assert.deepStrictEqual(dst_obj3.body, 'lalalala'); //  dst object was not overridden by the object in the source


        // override object data in src
        const obj_src_before_override = await get_object(s3_owner, bucket1, key1);
        await s3_owner.putObject({ Bucket: bucket1, Key: key1, Body: 'lalalala1' });

        // sync again - should replicate since src bucket is last modified
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix 1', res1);
        const obj_dst_after_repl = await get_object(s3_owner, bucket_for_replications, key1);
        const obj_src_after_override = await get_object(s3_owner, bucket1, key1);

        console.log('objs override src obj_src_before_override:',
            obj_src_before_override, obj_src_after_override,
            obj_dst_after_repl, obj_src_before_override,
            obj_dst_after_repl, obj_src_after_override);

        assert.deepStrictEqual(obj_src_after_override.body, 'lalalala1');
        assert.notDeepStrictEqual(obj_src_after_override.body, obj_src_before_override.body);
        assert.deepStrictEqual(obj_src_after_override.body, obj_dst_after_repl.body);

        // override object md in src
        const obj_src_before_override_md = await get_object(s3_owner, bucket1, key1);
        await s3_owner.putObject({ Bucket: bucket1, Key: key1, Body: 'lalalala1', Metadata: { key1: 'val1' }});
        const obj_dst_before_repl_md = await get_object(s3_owner, bucket_for_replications, key1);

        // sync again - should replicate since src bucket md is last modified
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix 2', res1);
        const obj_dst_after_repl_md = await get_object(s3_owner, bucket_for_replications, key1);
        const obj_src_after_override_md = await get_object(s3_owner, bucket1, key1);

        console.log('objs override src obj_src_before_override1:',
            obj_src_before_override_md, obj_src_after_override_md,
            obj_dst_after_repl_md, obj_dst_after_repl_md);

        assert.deepStrictEqual(obj_src_after_override_md.body, 'lalalala1');
        assert.deepStrictEqual(obj_src_after_override_md.metadata.key1, 'val1');
        assert.deepStrictEqual(obj_src_after_override_md.body, obj_src_before_override_md.body);
        assert.deepStrictEqual(obj_dst_after_repl_md.body, obj_src_before_override_md.body);
        assert.notDeepStrictEqual(obj_dst_before_repl_md.metadata, obj_dst_after_repl_md.metadata);
        assert.deepStrictEqual(obj_src_after_override_md.metadata, obj_dst_after_repl_md.metadata);
    });

    mocha.it('run replication scanner and wait - no prefix - all objects should be uploaded', async function() {
        const contents = await _list_objects_and_wait(s3_owner, bucket_for_replications, uploaded_prefix_objects_count);
        for (const content of contents) {
            const key = content.Key;
            await s3_owner.deleteObject({ Bucket: bucket_for_replications, Key: key });
        }
        await _put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket_for_replications, sync_versions: false }], false);
        const res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule no prefix', res1);
        await _list_objects_and_wait(s3_owner, bucket_for_replications, uploaded_objects_count);
    });

    mocha.it('run replication scanner and wait - 2 prefixes - all objects should be uploaded', async function() {
        await _put_replication(bucket1,
            [
                { rule_id: 'rule-1', destination_bucket: bucket2, sync_versions: false, filter: { prefix: 'key' } },
                { rule_id: 'rule-2', destination_bucket: bucket2, sync_versions: false, filter: { prefix: 'pref' } }
            ], false);

        const res = await _list_objects_and_wait(s3_owner, bucket1, uploaded_objects_count);
        console.log('waiting for replication objects original bucket ', res);
        let res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix1 ', res1);
        await _list_objects_and_wait(s3_owner, bucket2, 5 + special_character_items.length);
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix2 ', res1);
        await _list_objects_and_wait(s3_owner, bucket2, uploaded_objects_count);
    });

    mocha.it('run replication scanner and wait - 2 buckets - all objects should be uploaded', async function() {
        await _put_replication(bucket1,
            [
                { rule_id: 'rule-1', destination_bucket: bucket3, sync_versions: false, filter: { prefix: 'key' } },
                { rule_id: 'rule-2', destination_bucket: bucket4, sync_versions: false, filter: { prefix: 'pref' } }
            ], false);

        await _put_replication(bucket2,
            [
                { rule_id: 'rule-1', destination_bucket: bucket4, sync_versions: false, filter: { prefix: 'key' } },
                { rule_id: 'rule-2', destination_bucket: bucket3, sync_versions: false, filter: { prefix: 'pref' } }
            ], false);
        let res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix1 ', res1);
        await _list_objects_and_wait(s3_owner, bucket3, 5 + special_character_items.length);
        await _list_objects_and_wait(s3_owner, bucket4, uploaded_prefix_objects_count);

        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix2 ', res1);
        // everything is uploaded by combination of above 2
        await _list_objects_and_wait(s3_owner, bucket3, uploaded_objects_count);
        await _list_objects_and_wait(s3_owner, bucket4, uploaded_objects_count);
    });

});

async function _put_replication(bucket_name, replication_policy, should_fail) {
    try {
        await rpc_client.bucket.put_bucket_replication({ name: bucket_name, replication_policy: { rules: replication_policy } });
        if (should_fail) {
            assert.fail(`put_bucket_replication should fail but it passed`);
        }
    } catch (err) {
        if (should_fail) {
            assert.deepStrictEqual(err.rpc_code, 'INVALID_REPLICATION_POLICY');
            return;
        }
        assert.fail(`put_bucket_replication failed ${err}, ${err.stack}`);
    }
}

function create_random_body() {
    return Math.random().toString(36).slice(7);
}

async function put_object(s3_owner, bucket_name, key, optional_body) {
    const res = await s3_owner.putObject({ Bucket: bucket_name, Key: key, Body: optional_body || create_random_body() });
    console.log('put_object: ', util.inspect(res));
}


async function delete_object(s3_owner, bucket_name, key) {
    const res = await s3_owner.deleteObject({ Bucket: bucket_name, Key: key });
    console.log('delete_object: ', util.inspect(res));
}

// The function lists *all* objects in a given bucket, including buckets that have more than 1k objs
async function _list_all_objs_in_bucket(s3owner, bucket, prefix) {
    let isTruncated = true;
    let marker;
    const elements = [];
    while (isTruncated) {
        const params = { Bucket: bucket };
        if (prefix) params.Prefix = prefix;
        if (marker) params.Marker = marker;
        const response = await s3owner.listObjects(params);
        elements.push.apply(elements, response.Contents);
        isTruncated = response.IsTruncated;
        if (isTruncated) {
            marker = response.Contents.slice(-1)[0].Key;
        }
    }
    return elements;
}

async function _list_objects_and_wait(s3_owner, bucket, expected_num_of_objects) {
    let res;
    for (let retries = 1; retries <= 3; retries++) {
        try {
            res = await _list_all_objs_in_bucket(s3_owner, bucket);
            console.log('list_objects_and_wait: ', res);
            assert.deepStrictEqual(res.length, expected_num_of_objects);
            console.log(`list_objects contents: expected: ${expected_num_of_objects} actual: ${res.length} ${res}`);
            return res;
        } catch (e) {
            console.log(`waiting for replications of bucket: ${bucket}, response: ${res} `); //num of retries: ${retries}`);
            if (retries === 3) throw e;
            await P.delay(2 * 1000);
        }
    }
}

mocha.describe('Replication pagination test', function() {
    // Skip test if DB is not PostgreSQL
    if (config.DB_TYPE !== 'postgres') return;

    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);
    const obj_amount = 11;
    const src_bucket = 'src-bucket';
    const target_bucket = 'target-bucket';
    const buckets = [src_bucket, target_bucket];
    let s3_owner;
    let scanner;
    const s3_creds = {
        forcePathStyle: true,
        // signatureVersion is Deprecated in SDK v3
        //signatureVersion: 'v4',
        // automatically compute the MD5 checksums for of the request payload in SDKV3
        //computeChecksums: true,
        // s3DisableBodySigning renamed to applyChecksum but can be assigned in S3 object
        //s3DisableBodySigning: false,
        region: 'us-east-1',
        requestHandler: new NodeHttpHandler({
            httpsAgent: new http.Agent({ keepAlive: false })
        })
    };
    const src_bucket_keys = [];
    const target_bucket_keys = [];
    mocha.before('init scanner & populate buckets', async function() {
        process.env.REPLICATION_MAX_KEYS = "6";
        // create buckets
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.create_bucket({ name: bucket_name });
        }));
        await _put_replication(src_bucket, [
            { rule_id: '11obj-replication-rule', destination_bucket: target_bucket, sync_versions: false, filter: { prefix: '' } }
        ], false);
        const admin_account = await rpc_client.account.read_account({ email: EMAIL });
        const admin_keys = admin_account.access_keys;

        s3_creds.credentials = {
            accessKeyId: admin_keys[0].access_key.unwrap(),
            secretAccessKey: admin_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_owner = new S3(s3_creds);

        // populate source bucket
        for (let i = 0; i < obj_amount; i++) {
            const key = create_random_body();
            src_bucket_keys.push(key);
            await put_object(s3_owner, src_bucket, key);
        }

        cloud_utils.set_noobaa_s3_connection = () => {
            console.log('setting connection to coretest endpoint and access key');
            return s3_owner;
        };
        // init scanner
        scanner = new ReplicationScanner({
            name: 'replication_scanner',
            client: rpc_client
        });
        scanner.noobaa_connection = s3_owner; // needed when not calling batch
    });

    mocha.after('delete buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            for (let i = 0; i < src_bucket_keys.length; i++) {
                await delete_object(s3_owner, bucket_name, src_bucket_keys[i]);
            }
            for (let i = 0; i < target_bucket_keys.length; i++) {
                await delete_object(s3_owner, bucket_name, target_bucket_keys[i]);
            }
            await rpc_client.bucket.delete_bucket({ name: bucket_name });
            // Revert the replication scanner's
            delete process.env.REPLICATION_MAX_KEYS;
        }));
    });

    // Pagination test
    mocha.it('Testing bucket replication pagination with 11 objects', async function() {
        // Copy the first 6
        await scanner.run_batch();
        // Make sure that only 6 were copied
        await _list_objects_and_wait(s3_owner, target_bucket, 6);
        // Copy the remaining 5
        await scanner.run_batch();
        // Make sure all 11 objects were replicated
        await _list_objects_and_wait(s3_owner, target_bucket, obj_amount);
    });
});

// ─── NooBaa log-based replication integration tests ─────────────────────────

mocha.describe('NooBaa log-based replication - API and schema tests', function() {
    const src_bucket = 'noobaa-log-src';
    const log_bucket = 'noobaa-log-target';
    const dst_bucket = 'noobaa-log-dst';
    const buckets = [src_bucket, log_bucket, dst_bucket];

    mocha.before('create buckets', async function() {
        await P.all(_.map(buckets, async name => rpc_client.bucket.create_bucket({ name })));
    });

    mocha.beforeEach('setup replication policices', async () => {
        await rpc_client.bucket.put_bucket_replication({
            name: src_bucket,
            replication_policy: {
                rules: [{ rule_id: 'noobaa-log-rule-1', destination_bucket: dst_bucket, sync_versions: false }],
                log_replication_info: {
                    endpoint_type: 'NOOBAA',
                    logs_location: { logs_bucket: log_bucket, prefix: 'noobaa-logs/' },
                },
            },
        });
    });

    mocha.afterEach('cleanup replication policices', async () => {
        await rpc_client.bucket.delete_bucket_replication({ name: src_bucket });
    });

    mocha.after('clean up buckets and replication config', async function() {
        // Delete replication config before buckets
        try { await rpc_client.bucket.delete_bucket_replication({ name: src_bucket }); } catch (e) { /* ignore */ }
        await P.all(_.map(buckets, async name => {
            try { await rpc_client.bucket.delete_bucket({ name }); } catch (e) { /* ignore */ }
        }));
    });

    mocha.it('put_bucket_replication with NOOBAA endpoint_type should succeed', async function() {
        await rpc_client.bucket.put_bucket_replication({
            name: src_bucket,
            replication_policy: {
                rules: [{ rule_id: 'noobaa-log-rule-1', destination_bucket: dst_bucket, sync_versions: false }],
                log_replication_info: {
                    endpoint_type: 'NOOBAA',
                    logs_location: { logs_bucket: log_bucket, prefix: 'noobaa-logs/' },
                },
            },
        });
    });

    mocha.it('get_bucket_replication returns the stored NooBaa log config', async function() {
        const repl = await rpc_client.bucket.get_bucket_replication({ name: src_bucket });
        assert.ok(repl.log_replication_info, 'log_replication_info should be present');
        const noobaa_info = repl.log_replication_info.noobaa_log_replication_info;
        assert.ok(noobaa_info, 'noobaa_log_replication_info should be present');
        assert.strictEqual(noobaa_info.logs_location.logs_bucket, log_bucket, 'logs_bucket should match');
        assert.strictEqual(noobaa_info.logs_location.prefix, 'noobaa-logs/', 'prefix should match');
        assert.ok(repl.rules && repl.rules.length > 0, 'rules should be present');
        assert.strictEqual(repl.rules[0].rule_id, 'noobaa-log-rule-1', 'rule_id should match');
        assert.strictEqual(repl.rules[0].destination_bucket.unwrap(), dst_bucket, 'destination_bucket should match');
    });

    mocha.it('find_log_based_replication_rules returns the NooBaa policy', async function() {
        const replication_store = require('../../../../server/system_services/replication_store').instance();
        const log_policies = await replication_store.find_log_based_replication_rules();
        const noobaa_policy = log_policies.find(p => p.log_replication_info?.noobaa_log_replication_info);
        assert.ok(noobaa_policy, 'NooBaa log replication policy should be found by find_log_based_replication_rules');
        assert.strictEqual(
            noobaa_policy.log_replication_info.noobaa_log_replication_info.logs_location.logs_bucket,
            log_bucket
        );
    });

    mocha.it('put_bucket_replication with NOOBAA endpoint_type but no prefix should succeed', async function() {
        await rpc_client.bucket.put_bucket_replication({
            name: src_bucket,
            replication_policy: {
                rules: [{ rule_id: 'noobaa-log-rule-nopfx', destination_bucket: dst_bucket, sync_versions: false }],
                log_replication_info: {
                    endpoint_type: 'NOOBAA',
                    logs_location: { logs_bucket: log_bucket },
                },
            },
        });
    });

    mocha.it('put_bucket_replication with NOOBAA endpoint_type but non-existent log bucket should fail', async function() {
        try {
            await rpc_client.bucket.put_bucket_replication({
                name: src_bucket,
                replication_policy: {
                    rules: [{ rule_id: 'noobaa-log-rule-bad', destination_bucket: dst_bucket, sync_versions: false }],
                    log_replication_info: {
                        endpoint_type: 'NOOBAA',
                        logs_location: { logs_bucket: 'does-not-exist' },
                    },
                },
            });
            assert.fail('put_bucket_replication should have failed for a missing log bucket');
        } catch (err) {
            assert.deepStrictEqual(err.rpc_code, 'INVALID_TARGET_BUCKET');
        }
    });
});

mocha.describe('NooBaa log-based replication - end-to-end scanner test', function() {
    // These tests require PostgreSQL and real S3 operations.
    if (config.DB_TYPE !== 'postgres') return;

    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(120000);

    const src_bucket = 'noobaa-log-e2e-src';
    const log_bucket = 'noobaa-log-e2e-logs';
    const dst_bucket = 'noobaa-log-e2e-dst';
    const buckets = [src_bucket, log_bucket, dst_bucket];
    const log_prefix = 'src-logs/';

    let s3_owner;
    let log_scanner;
    const uploaded_keys = [];

    const s3_creds = {
        forcePathStyle: true,
        region: 'us-east-1',
        requestHandler: new NodeHttpHandler({
            httpsAgent: new http.Agent({ keepAlive: false })
        })
    };

    /**
     * Builds a NooBaa PERSISTENT-mode log object body for a list of S3 operations.
     * Mirrors the format produced by get_bucket_log_record() in s3_bucket_logging.js.
     */
    function make_log_object_body(ops) {
        return ops.map(op => JSON.stringify({
            op: op.method || 'PUT',
            source_bucket: op.source_bucket || src_bucket,
            object_key: op.object_key || `/${op.source_bucket || src_bucket}/${op.key}`,
            http_status: op.http_status || 200,
            noobaa_bucket_logging: true,
            timestamp: op.timestamp || new Date().toISOString(),
            remote_ip: '127.0.0.1',
            request_id: `test-${Math.random().toString(36).slice(2)}`,
            log_bucket,
            log_prefix,
        })).join('\n') + '\n';
    }

    mocha.before('setup buckets, replication, and S3 client', async function() {
        await P.all(_.map(buckets, async name => rpc_client.bucket.create_bucket({ name })));

        const admin_account = await rpc_client.account.read_account({ email: EMAIL });
        const admin_keys = admin_account.access_keys;
        s3_creds.credentials = {
            accessKeyId: admin_keys[0].access_key.unwrap(),
            secretAccessKey: admin_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_owner = new S3(s3_creds);

        // Configure bucket logging on src_bucket → log_bucket (not strictly needed for
        // the scanner test since we upload log objects manually, but validates the API path)
        await rpc_client.bucket.put_bucket_logging({
            name: src_bucket,
            logging: { log_bucket, log_prefix },
        });

        // Configure NooBaa log-based replication: src → dst, reading logs from log_bucket
        await rpc_client.bucket.put_bucket_replication({
            name: src_bucket,
            replication_policy: {
                rules: [{ rule_id: 'e2e-noobaa-log-rule', destination_bucket: dst_bucket, sync_versions: false }],
                log_replication_info: {
                    endpoint_type: 'NOOBAA',
                    logs_location: { logs_bucket: log_bucket, prefix: log_prefix },
                },
            },
        });

        // Point the noobaa S3 connection to our coretest endpoint
        cloud_utils.set_noobaa_s3_connection = () => s3_owner;

        log_scanner = new LogReplicationScanner({
            name: 'log_replication_scanner',
            client: rpc_client,
        });
        log_scanner.noobaa_connection = s3_owner;
    });

    mocha.after('delete buckets and config', async function() {
        try { await rpc_client.bucket.delete_bucket_replication({ name: src_bucket }); } catch (e) { /* ignore */ }
        await P.all(_.map(buckets, async bucket_name => {
            // Empty the bucket before deleting
            try {
                const list = await s3_owner.listObjectsV2({ Bucket: bucket_name });
                if (list.Contents) {
                    for (const obj of list.Contents) {
                        await s3_owner.deleteObject({ Bucket: bucket_name, Key: obj.Key });
                    }
                }
                await rpc_client.bucket.delete_bucket({ name: bucket_name });
            } catch (e) { /* ignore */ }
        }));
    });

    mocha.it('scanner run with empty log bucket produces no candidates', async function() {
        const result = await log_scanner.run_batch();
        // Empty log bucket → nothing to replicate
        const dst_list = await s3_owner.listObjectsV2({ Bucket: dst_bucket });
        assert.strictEqual((dst_list.Contents || []).length, 0,
            'dst_bucket should be empty when there are no log objects');
        console.log('run_batch result (empty logs):', result);
    });

    mocha.it('scanner replicates objects recorded in a manually uploaded log object', async function() {
        // Upload two real objects to the source bucket
        const key1 = `e2e-obj-${create_random_body()}`;
        const key2 = `e2e-obj-${create_random_body()}`;
        await put_object(s3_owner, src_bucket, key1);
        await put_object(s3_owner, src_bucket, key2);
        uploaded_keys.push(key1, key2);

        // The log object contains one JSON line per operation.
        const log_object_key = `${log_prefix}${new Date().toISOString().replace(/[:.]/g, '-')}-TESTLOGOBJ`;
        const log_body = make_log_object_body([
            { key: key1 },
            { key: key2 },
        ]);
        await s3_owner.putObject({ Bucket: log_bucket, Key: log_object_key, Body: log_body });
        console.log('Uploaded log object:', log_object_key);

        await log_scanner.run_batch();

        // Both objects should now appear in dst_bucket
        await _list_objects_and_wait(s3_owner, dst_bucket, 2);

        // Verify the actual keys are present (not just the count)
        const dst_list = await s3_owner.listObjectsV2({ Bucket: dst_bucket });
        const dst_keys = (dst_list.Contents || []).map(o => o.Key).sort();
        assert.deepStrictEqual(dst_keys.sort(), [key1, key2].sort(),
            'Destination bucket should contain exactly the two replicated keys');
    });

    mocha.it('scanner skips pre-operation (status 102) log entries', async function() {
        // Both keys exist in the source bucket so that HeadObject succeeds for both.
        // The ONLY reason intention_key should not reach the destination is the 102 filter.
        const real_key = `e2e-real-${create_random_body()}`;
        const intention_key = `e2e-intention-${create_random_body()}`;
        await put_object(s3_owner, src_bucket, real_key);
        await put_object(s3_owner, src_bucket, intention_key);
        uploaded_keys.push(real_key, intention_key);

        // Log object: one pre-operation intention entry (status 102, must be skipped)
        // and one post-operation entry (status 200, must be replicated).
        const log_object_key = `${log_prefix}${new Date().toISOString().replace(/[:.]/g, '-')}-TESTLOGOBJ102`;
        const log_body = make_log_object_body([
            { key: intention_key, http_status: 102 },
            { key: real_key, http_status: 200 },
        ]);
        await s3_owner.putObject({ Bucket: log_bucket, Key: log_object_key, Body: log_body });

        // Get current dst state before scan
        const before = await s3_owner.listObjectsV2({ Bucket: dst_bucket });
        const count_before = (before.Contents || []).length;

        await log_scanner.run_batch();

        const after = await s3_owner.listObjectsV2({ Bucket: dst_bucket });
        const after_keys = (after.Contents || []).map(o => o.Key);

        // real_key must be replicated
        assert.ok(after_keys.includes(real_key),
            `${real_key} should have been replicated`);
        assert.ok((after.Contents || []).length >= count_before + 1,
            'At least the real key should have been replicated after the 102-skip scan');

        // intention_key must NOT be replicated — it exists in the source bucket so the
        // only thing preventing replication is the status-102 filter in the parser.
        assert.ok(!after_keys.includes(intention_key),
            `${intention_key} should NOT have been replicated (its log entry had status 102)`);
    });

    mocha.it('scanner respects object key prefix filter in replication rules', async function() {
        // Reconfigure replication with a prefix filter so only 'filtered/' keys are replicated
        await rpc_client.bucket.put_bucket_replication({
            name: src_bucket,
            replication_policy: {
                rules: [{
                    rule_id: 'e2e-noobaa-pfx-rule',
                    destination_bucket: dst_bucket,
                    sync_versions: false,
                    filter: { prefix: 'filtered/' },
                }],
                log_replication_info: {
                    endpoint_type: 'NOOBAA',
                    logs_location: { logs_bucket: log_bucket, prefix: log_prefix },
                },
            },
        });

        const matched_key = `filtered/${create_random_body()}`;
        const unmatched_key = `other/${create_random_body()}`;
        await put_object(s3_owner, src_bucket, matched_key);
        await put_object(s3_owner, src_bucket, unmatched_key);
        uploaded_keys.push(matched_key, unmatched_key);

        const log_object_key = `${log_prefix}${new Date().toISOString().replace(/[:.]/g, '-')}-TESTLOGPFX`;
        const log_body = make_log_object_body([
            { key: matched_key },
            { key: unmatched_key },
        ]);
        await s3_owner.putObject({ Bucket: log_bucket, Key: log_object_key, Body: log_body });

        const before = await s3_owner.listObjectsV2({ Bucket: dst_bucket });

        await log_scanner.run_batch();

        const after = await s3_owner.listObjectsV2({ Bucket: dst_bucket });
        const new_keys = (after.Contents || []).map(o => o.Key).filter(k => !before.Contents?.find(o => o.Key === k));

        assert.ok(new_keys.includes(matched_key), `${matched_key} should have been replicated (matches prefix)`);
        assert.ok(!new_keys.includes(unmatched_key), `${unmatched_key} should NOT have been replicated (no prefix match)`);
    });
});
