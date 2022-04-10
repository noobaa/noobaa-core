/* Copyright (C) 2020 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const _ = require('lodash');
const P = require('../../util/promise');
const coretest = require('./coretest');
const { rpc_client, EMAIL } = coretest; //, PASSWORD, SYSTEM
const util = require('util');
const AWS = require('aws-sdk');
const http = require('http');
const SensitiveString = require('../../util/sensitive_string');
const cloud_utils = require('../../util/cloud_utils');
const { ReplicationScanner } = require('../../server/bg_services/replication_scanner');


const db_client = require('../../util/db_client').instance();
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

    mocha.it('put_replication - same dst bucket & no prefixes - should fail', async function() {
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: first_bucket }, { rule_id: 'rule-2', destination_bucket: first_bucket }], true);
    });

    mocha.it('put_replication - same dst bucket & 1 prefix - should fail ', async function() {
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: first_bucket, filter: { prefix: 'lala' } }, { rule_id: 'rule-2', destination_bucket: first_bucket }], true);
    });

    mocha.it('put_replication - 2 replication rules same rule_id - should fail', async function() {
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: first_bucket }, { rule_id: 'rule-1', destination_bucket: bucket1 }], true);
    });

    mocha.it('put_replication 1 - valid', async function() {
        await put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket }], false);
    });


    mocha.it('put_replication - same dst bucket & prefix is a prefix of prefix 1 - should fail', async function() {
        await put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: bucket1, filter: { prefix: 'a' } },
            { rule_id: 'rule-2', destination_bucket: bucket1, filter: { prefix: '' } }
        ], true);
    });

    mocha.it('put_replication - same dst bucket & prefix is a prefix of prefix 2 - should fail', async function() {
        await put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: bucket1, filter: { prefix: 'a' } },
            { rule_id: 'rule-2', destination_bucket: bucket1, filter: { prefix: 'ab' } }
        ], true);
    });

    mocha.it('put_replication 2 - valid', async function() {
        await put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, filter: { prefix: 'a' } },
            { rule_id: 'rule-2', destination_bucket: bucket1, filter: { prefix: 'ba' } }
        ], false);
    });

    mocha.it('put_replication 3 - valid', async function() {
        await put_replication(bucket2, [
            { rule_id: 'rule-1', destination_bucket: bucket1, filter: { prefix: '' } },
            { rule_id: 'rule-2', destination_bucket: first_bucket, filter: { prefix: 'ab' } }
        ], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });

        assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === bucket1 && res.rules[0].filter.prefix === '');
        assert.ok(res.rules[1].rule_id === 'rule-2' && res.rules[1].destination_bucket.unwrap() === first_bucket && res.rules[1].filter.prefix === 'ab');
    });

    mocha.it('put_replication 4 - valid', async function() {
        await put_replication(bucket1, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, filter: { prefix: '' } }
        ], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === first_bucket && res.rules[0].filter.prefix === '');
    });

    mocha.it('put_replication 5 - valid', async function() {
        await put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket }], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res.rules[0].rule_id === 'rule-1' && res.rules[0].destination_bucket.unwrap() === first_bucket);
    });

    mocha.it('put_replication - same rule_id - should fail ', async function() {
        await put_replication(bucket1, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, filter: { prefix: 'b' } },
            { rule_id: 'rule-1', destination_bucket: bucket2, filter: { prefix: 'a' } }
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
    const replication_store = require('../../server/system_services/replication_store').instance();

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

    mocha.it('put_replication on both buckets 1', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await put_replication(bucket_name, [{ rule_id: 'rule-1', destination_bucket: first_bucket }], false);
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

    mocha.it('put_replication on both buckets 2', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await put_replication(bucket_name, [{ rule_id: 'rule-2', destination_bucket: first_bucket }], false);
            const res = await rpc_client.bucket.get_bucket_replication({ name: bucket_name });
            assert.ok(res.rules[0].rule_id === 'rule-2' && res.rules[0].destination_bucket.unwrap() === first_bucket);
        }));
    });

    mocha.it('update bucket replication of bucket1', async function() {
        await put_replication(bucket1, [{ rule_id: 'rule-3', destination_bucket: first_bucket }], false);
        const repl_buck1 = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        const repl_buck2 = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });
        assert.ok(repl_buck1.rules[0].rule_id === 'rule-3');
        assert.ok(repl_buck2.rules[0].rule_id === 'rule-2');

        const repl1 = ((await rpc_client.bucket.read_bucket({ name: bucket1 })).replication_policy_id);
        const repl2 = ((await rpc_client.bucket.read_bucket({ name: bucket2 })).replication_policy_id);
        assert.ok(repl1 !== repl2);
    });

    mocha.it('update bucket replication of bucket2', async function() {
        await put_replication(bucket2, [{ rule_id: 'rule-3', destination_bucket: first_bucket }], false);
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
    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);
    const bucket1 = 'bucket1-br-bg';
    const bucket2 = 'bucket2-br-bg';
    const bucket3 = 'bucket3-br-bg';
    const bucket4 = 'bucket4-br-bg';
    const bucket_for_replications = 'bucket5-br-bg';
    const bucket_to_delete = 'bucket-to-delete';
    const buckets = [bucket1, bucket2, bucket_to_delete, bucket3, bucket4, bucket_for_replications];
    //const namespace_buckets = [];
    let s3_owner;
    let scanner;
    let s3_creds = {
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) },
    };
    mocha.before('init scanner & populate buckets', async function() {
        // create buckets
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.create_bucket({ name: bucket_name });
        }));
        const admin_account = await rpc_client.account.read_account({ email: EMAIL });
        const admin_keys = admin_account.access_keys;
        //await create_namespace_buckets(admin_account);

        s3_creds.accessKeyId = admin_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = admin_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_owner = new AWS.S3(s3_creds);
        // populate buckets
        for (let i = 0; i < 10; i++) {
            let key = `key${i}`;
            if (i % 2 === 0) key = 'pref' + key;
            await put_object(s3_owner, bucket1, key);
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
    });

    mocha.after('delete buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            if (bucket_name === bucket_to_delete) return;
            for (let i = 0; i < 10; i++) {
                let key = `key${i}`;
                if (i % 2 === 0) key = 'pref' + key;
                await delete_object(s3_owner, bucket_name, key);
            }
            await rpc_client.bucket.delete_bucket({ name: bucket_name });
        }));
    });

    mocha.it('run replication scanner and wait - no replication - nothing to upload', async function() {
        const res1 = await scanner.run_batch();
        console.log('waiting for replication objects no objects to upload', res1);
        await list_objects_and_wait(s3_owner, bucket_for_replications, 0);
    });

    mocha.it('run replication scanner and delete bucket', async function() {
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket_to_delete, filter: { prefix: bucket1 } }], false);

        await rpc_client.bucket.delete_bucket({ name: bucket_to_delete });
        const res1 = await scanner.run_batch();
        // no error, just moving to the next cycle
        assert.deepStrictEqual(res1, 300000);
    });

    mocha.it('run replication scanner and wait - prefix - prefixed objects should be uploaded', async function() {
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket_for_replications, filter: { prefix: 'pref' } }], false);
        let res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix', res1);
        let contents = await list_objects_and_wait(s3_owner, bucket_for_replications, 5);
        console.log('contents', contents);

        // delete object from dst
        await s3_owner.deleteObject({ Bucket: bucket_for_replications, Key: contents[0].Key }).promise();
        await list_objects_and_wait(s3_owner, bucket_for_replications, 4);
        // sync again
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix', res1);
        contents = await list_objects_and_wait(s3_owner, bucket_for_replications, 5);
        const key1 = contents[0].Key;
        // override object in dst
        const dst_obj1 = await s3_owner.getObject({ Bucket: bucket_for_replications, Key: key1 }).promise();
        await s3_owner.putObject({ Bucket: bucket_for_replications, Key: key1, Body: 'lalalala' }).promise();
        const dst_obj2 = await s3_owner.getObject({ Bucket: bucket_for_replications, Key: key1 }).promise();
        console.log('objs override dst1', dst_obj1, dst_obj2, dst_obj1.Body.toString(), dst_obj2.Body.toString());

        assert.deepStrictEqual(dst_obj2.Body.toString(), 'lalalala'); // dst object was updated correctly
        assert.notDeepStrictEqual(dst_obj1.Body.toString(), dst_obj2.Body.toString()); // new dst object was updated and 
        // now is diff from the original dst object

        // sync again - should not replicate since dst bucket is last modified
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix', res1);
        const dst_obj3 = await s3_owner.getObject({ Bucket: bucket_for_replications, Key: key1 }).promise();
        const src_obj = await s3_owner.getObject({ Bucket: bucket1, Key: key1 }).promise();

        console.log('objs override dst2', src_obj, dst_obj3, src_obj.Body.toString(), dst_obj3.Body.toString());
        assert.notDeepStrictEqual(src_obj.Body.toString(), dst_obj3.Body.toString()); // object in src !== object in dst 
        assert.deepStrictEqual(dst_obj3.Body.toString(), 'lalalala'); //  dst object was not overriden


        // override object data in src
        const obj_src_before_ovverride = await s3_owner.getObject({ Bucket: bucket1, Key: key1 }).promise();
        await s3_owner.putObject({ Bucket: bucket1, Key: key1, Body: 'lalalala1' }).promise();

        // sync again - should replicate since src bucket is last modified
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix 1', res1);
        const obj_dst_after_repl = await s3_owner.getObject({ Bucket: bucket_for_replications, Key: key1 }).promise();
        const obj_src_after_ovverride = await s3_owner.getObject({ Bucket: bucket1, Key: key1 }).promise();

        console.log('objs ovverride src obj_src_before_ovverride:',
            obj_src_before_ovverride, obj_src_after_ovverride,
            obj_dst_after_repl, obj_src_before_ovverride.Body.toString(),
            obj_dst_after_repl.Body.toString(), obj_src_after_ovverride.Body.toString());

        assert.deepStrictEqual(obj_src_after_ovverride.Body.toString(), 'lalalala1');
        assert.notDeepStrictEqual(obj_src_after_ovverride.Body.toString(), obj_src_before_ovverride.Body.toString());
        assert.deepStrictEqual(obj_src_after_ovverride.Body.toString(), obj_dst_after_repl.Body.toString());


        // override object md in src
        const obj_src_before_ovverride_md = await s3_owner.getObject({ Bucket: bucket1, Key: key1 }).promise();
        await s3_owner.putObject({ Bucket: bucket1, Key: key1, Body: 'lalalala1', Metadata: { key1: 'val1' } }).promise();
        const obj_dst_before_repl_md = await s3_owner.getObject({ Bucket: bucket_for_replications, Key: key1 }).promise();

        // sync again - should replicate since src bucket md is last modified
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule one prefix 2', res1);
        const obj_dst_after_repl_md = await s3_owner.getObject({ Bucket: bucket_for_replications, Key: key1 }).promise();
        const obj_src_after_ovverride_md = await s3_owner.getObject({ Bucket: bucket1, Key: key1 }).promise();

        console.log('objs ovverride src obj_src_before_ovverride1:',
            obj_src_before_ovverride_md, obj_src_after_ovverride_md,
            obj_dst_after_repl_md, obj_src_before_ovverride_md.Body.toString(),
            obj_dst_after_repl_md.Body.toString(), obj_src_after_ovverride_md.Body.toString());

        assert.deepStrictEqual(obj_src_after_ovverride_md.Body.toString(), 'lalalala1');
        assert.deepStrictEqual(obj_src_after_ovverride_md.Metadata, { key1: 'val1' });
        assert.deepStrictEqual(obj_src_after_ovverride_md.Body.toString(), obj_src_before_ovverride_md.Body.toString());
        assert.deepStrictEqual(obj_dst_after_repl_md.Body.toString(), obj_src_before_ovverride_md.Body.toString());
        assert.notDeepStrictEqual(obj_dst_before_repl_md.Metadata, obj_dst_after_repl_md.Metadata);
        assert.deepStrictEqual(obj_src_after_ovverride_md.Metadata, obj_dst_after_repl_md.Metadata);
    });

    mocha.it('run replication scanner and wait - no prefix - all objects should be uploaded', async function() {
        let contents = await list_objects_and_wait(s3_owner, bucket_for_replications, 5);
        for (let content of contents) {
            const key = content.Key;
            await s3_owner.deleteObject({ Bucket: bucket_for_replications, Key: key }).promise();
        }
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket_for_replications }], false);
        const res1 = await scanner.run_batch();
        console.log('waiting for replication objects - one rule no prefix', res1);
        await list_objects_and_wait(s3_owner, bucket_for_replications, 10);
    });

    mocha.it('run replication scanner and wait - 2 prefixes - all objects should be uploaded', async function() {
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket2, filter: { prefix: 'key' } },
                { rule_id: 'rule-2', destination_bucket: bucket2, filter: { prefix: 'pref' } }
            ], false);

        const res = await list_objects_and_wait(s3_owner, bucket1, 10);
        console.log('waiting for replication objects original bucket ', res);
        let res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix1 ', res1);
        await list_objects_and_wait(s3_owner, bucket2, 5);
        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix2 ', res1);
        await list_objects_and_wait(s3_owner, bucket2, 10);
    });

    mocha.it('run replication scanner and wait - 2 buckets - all objects should be uploaded', async function() {
        await put_replication(bucket1,
            [{ rule_id: 'rule-1', destination_bucket: bucket3, filter: { prefix: 'key' } },
                { rule_id: 'rule-2', destination_bucket: bucket4, filter: { prefix: 'pref' } }
            ], false);

        await put_replication(bucket2,
            [{ rule_id: 'rule-1', destination_bucket: bucket4, filter: { prefix: 'key' } },
                { rule_id: 'rule-2', destination_bucket: bucket3, filter: { prefix: 'pref' } }
            ], false);
        let res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix1 ', res1);
        await list_objects_and_wait(s3_owner, bucket3, 5);
        await list_objects_and_wait(s3_owner, bucket4, 5);

        res1 = await scanner.run_batch();
        console.log('waiting for replication objects - 2 rules 1 prefix2 ', res1);
        await list_objects_and_wait(s3_owner, bucket3, 10);
        await list_objects_and_wait(s3_owner, bucket4, 10);
    });

});


mocha.describe('replication pagination tests', function() {
    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);
    const bucket1 = 'bucket1-pg';
    const bucket2 = 'bucket2-pg';
    const bucket3 = 'bucket3-pg';
    const bucket4 = 'bucket4-pg';
    const bucket_for_replications = 'bucket5-pg';
    const buckets = [bucket1, bucket2, bucket3, bucket4, bucket_for_replications];
    //const namespace_buckets = [];
    let s3_owner;
    let scanner;
    let s3_creds = {
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) },
    };
    let bucket2_keys = [];
    let bucket1_keys = [];
    mocha.before('init scanner & populate buckets', async function() {
        // create buckets
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.create_bucket({ name: bucket_name });
        }));
        const admin_account = await rpc_client.account.read_account({ email: EMAIL });
        const admin_keys = admin_account.access_keys;
        //await create_namespace_buckets(admin_account);

        s3_creds.accessKeyId = admin_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = admin_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_owner = new AWS.S3(s3_creds);

        // populate bucket2
        for (let i = 0; i < 5; i++) {
            let key = create_random_body();
            bucket2_keys.push(key);
            await put_object(s3_owner, bucket2, key);
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
            for (let i = 0; i < bucket2_keys.length; i++) {
                await delete_object(s3_owner, bucket_name, bucket2_keys[i]);
            }
            for (let i = 0; i < bucket1_keys.length; i++) {
                await delete_object(s3_owner, bucket_name, bucket1_keys[i]);
            }
            await rpc_client.bucket.delete_bucket({ name: bucket_name });
        }));
    });

    // Pagination tests
    mocha.it('list_buckets_and_compare - to_replicate_arr = [], tokens undefined', async function() {
        process.env.REPLICATION_MAX_KEYS = "5";
        // bucket1 is empty - nothing to replicate
        const { keys_sizes_map_to_copy, src_cont_token, dst_cont_token } = await
        scanner.list_buckets_and_compare(new SensitiveString(bucket1), new SensitiveString(bucket2), '', '', '');
        console.log('check pagination1: ', keys_sizes_map_to_copy, src_cont_token, dst_cont_token);
        assert.deepStrictEqual(keys_sizes_map_to_copy, {});
        assert.deepStrictEqual(src_cont_token, '');
        assert.deepStrictEqual(dst_cont_token, '');
    });

    mocha.it('list_buckets_and_compare - to_replicate_arr = all objects in src bucket, tokens undefined', async function() {
        // bucket2 is empty - replicate all objects in bucket1
        const { keys_sizes_map_to_copy, src_cont_token, dst_cont_token } = await
        scanner.list_buckets_and_compare(new SensitiveString(bucket2), new SensitiveString(bucket1), '', '', '');
        console.log('check pagination2: ', keys_sizes_map_to_copy, src_cont_token, dst_cont_token);
        assert.deepStrictEqual(Object.keys(keys_sizes_map_to_copy), bucket2_keys.sort());
        assert.deepStrictEqual(src_cont_token, '');
        assert.deepStrictEqual(dst_cont_token, '');

        await empty_bucket(s3_owner, bucket2, bucket2_keys);
    });

    mocha.it('list_buckets_and_compare - 1 ', async function() {
        let src_keys = ['a1', 'a2', 'b1', 'b2', 'b3', 'b4'];
        let dst_keys = ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b4'];
        bucket1_keys = src_keys;
        bucket2_keys = dst_keys;
        for (let i = 0; i < src_keys.length; i++) {
            await put_object(s3_owner, bucket1, src_keys[i], src_keys[i]);
        }
        for (let i = 0; i < dst_keys.length; i++) {
            await put_object(s3_owner, bucket2, dst_keys[i], dst_keys[i]);
        }

        const diff1 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', '', '');
        console.log('check pagination3: ', diff1.keys_sizes_map_to_copy, diff1.src_cont_token, diff1.dst_cont_token);
        assert.deepStrictEqual(Object.keys(diff1.keys_sizes_map_to_copy), ['b3']);
        assert.notDeepStrictEqual(diff1.src_cont_token, '');
        assert.notDeepStrictEqual(diff1.dst_cont_token, '');

        const diff2 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', diff1.src_cont_token, diff1.dst_cont_token);
        console.log('check pagination4: ', diff2.keys_sizes_map_to_copy, diff2.src_cont_token, diff2.dst_cont_token);
        assert.deepStrictEqual(diff2.keys_sizes_map_to_copy, {});
        assert.deepStrictEqual(diff2.src_cont_token, '');
        assert.deepStrictEqual(diff2.dst_cont_token, '');

        await empty_bucket(s3_owner, bucket1, bucket1_keys);
        await empty_bucket(s3_owner, bucket2, bucket2_keys);
    });

    mocha.it('list_buckets_and_compare - 2 ', async function() {
        let src_keys = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
        let dst_keys = ['a1', 'a2', 'a3', 'a4', 'a5', 'b6', 'b7'];
        bucket1_keys = src_keys;
        bucket2_keys = dst_keys;
        for (let i = 0; i < src_keys.length; i++) {
            await put_object(s3_owner, bucket1, src_keys[i], src_keys[i]);
        }
        for (let i = 0; i < dst_keys.length; i++) {
            await put_object(s3_owner, bucket2, dst_keys[i], dst_keys[i]);
        }

        const diff1 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', '', '');
        console.log('check pagination3: ', diff1.keys_sizes_map_to_copy, diff1.src_cont_token, diff1.dst_cont_token);
        assert.deepStrictEqual(Object.keys(diff1.keys_sizes_map_to_copy), ['b1', 'b2', 'b3', 'b4', 'b5']);
        assert.notDeepStrictEqual(diff1.src_cont_token, '');
        assert.notDeepStrictEqual(diff1.dst_cont_token, '');

        const diff2 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', diff1.src_cont_token, diff1.dst_cont_token);
        console.log('check pagination4: ', diff2.keys_sizes_map_to_copy, diff2.src_cont_token, diff2.dst_cont_token);
        assert.deepStrictEqual(Object.keys(diff2.keys_sizes_map_to_copy), ['b8']);
        assert.deepStrictEqual(diff2.src_cont_token, '');
        assert.deepStrictEqual(diff2.dst_cont_token, '');

        await empty_bucket(s3_owner, bucket1, bucket1_keys);
        await empty_bucket(s3_owner, bucket2, bucket2_keys);
    });

    mocha.it('list_buckets_and_compare - 3 ', async function() {
        let src_keys = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'z1', 'z2', 'z3', 'z4'];
        let dst_keys = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'c1', 'c2', 'c3', 'c4'];
        for (let i = 0; i < src_keys.length; i++) {
            await put_object(s3_owner, bucket1, src_keys[i], src_keys[i]);
        }
        for (let i = 0; i < dst_keys.length; i++) {
            bucket1_keys.push(dst_keys[i]);
            await put_object(s3_owner, bucket2, dst_keys[i], dst_keys[i]);
        }
        bucket1_keys = src_keys;
        bucket2_keys = dst_keys;

        const diff1 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', '', '');
        console.log('check pagination3: ', diff1.keys_sizes_map_to_copy, diff1.src_cont_token, diff1.dst_cont_token);
        assert.deepStrictEqual(diff1.keys_sizes_map_to_copy, {});
        assert.notDeepStrictEqual(diff1.src_cont_token, '');
        assert.notDeepStrictEqual(diff1.dst_cont_token, '');

        const diff2 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', diff1.src_cont_token, diff1.dst_cont_token);
        console.log('check pagination4: ', diff2.keys_sizes_map_to_copy, diff2.src_cont_token, diff2.dst_cont_token);
        assert.deepStrictEqual(Object.keys(diff2.keys_sizes_map_to_copy), ['z1', 'z2', 'z3', 'z4']);
        assert.deepStrictEqual(diff2.src_cont_token, '');
        assert.deepStrictEqual(diff2.dst_cont_token, '');

        await empty_bucket(s3_owner, bucket1, bucket1_keys);
        await empty_bucket(s3_owner, bucket2, bucket2_keys);
    });

    mocha.it('list_buckets_and_compare - 4 ', async function() {
        let src_keys = ['a1', 'a2', 'a3', 'a4', 'a5'];
        let dst_keys = ['a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14'];
        for (let i = 0; i < src_keys.length; i++) {
            await put_object(s3_owner, bucket1, src_keys[i], src_keys[i]);
        }
        for (let i = 0; i < dst_keys.length; i++) {
            bucket1_keys.push(dst_keys[i]);
            await put_object(s3_owner, bucket2, dst_keys[i], dst_keys[i]);
        }
        bucket1_keys = src_keys;
        bucket2_keys = dst_keys;

        const diff1 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', '', '');
        console.log('check pagination3: ', diff1.keys_sizes_map_to_copy, diff1.src_cont_token, diff1.dst_cont_token);
        assert.deepStrictEqual(Object.keys(diff1.keys_sizes_map_to_copy), ['a1', 'a2', 'a3', 'a4']);
        assert.deepStrictEqual(diff1.src_cont_token, '');
        assert.deepStrictEqual(diff1.dst_cont_token, '');

        await empty_bucket(s3_owner, bucket1, bucket1_keys);
        await empty_bucket(s3_owner, bucket2, bucket2_keys);
    });


    mocha.it('list_buckets_and_compare - 5 ', async function() {
        let src_keys = ['a1', 'a2', 'a3', 'a4', 'a5',
            'c1', 'c2', 'c3', 'c4', 'c5',
            'd1', 'd2', 'd3', 'd4', 'd5'
        ];
        let dst_keys = ['a1', 'a2', 'a3', 'a4', 'a5',
            'b1', 'b2', 'b3', 'b4', 'b5',
            'c1', 'c2', 'c3', 'c4', 'c5',
            'd1', 'd2', 'd3', 'd4', 'd5'
        ];
        for (let i = 0; i < src_keys.length; i++) {
            await put_object(s3_owner, bucket1, src_keys[i], src_keys[i]);
        }
        for (let i = 0; i < dst_keys.length; i++) {
            bucket1_keys.push(dst_keys[i]);
            await put_object(s3_owner, bucket2, dst_keys[i], dst_keys[i]);
        }
        bucket1_keys = src_keys;
        bucket2_keys = dst_keys;

        const diff1 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', '', '');
        console.log('check pagination33: ', diff1.keys_sizes_map_to_copy, diff1.src_cont_token, diff1.dst_cont_token);
        assert.deepStrictEqual(diff1.keys_sizes_map_to_copy, {});
        assert.notDeepStrictEqual(diff1.src_cont_token, '');
        assert.notDeepStrictEqual(diff1.dst_cont_token, '');

        const diff2 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', diff1.src_cont_token, diff1.dst_cont_token);
        console.log('check pagination44: ', diff2.keys_sizes_map_to_copy, diff2.src_cont_token, diff2.dst_cont_token);
        assert.deepStrictEqual(diff2.keys_sizes_map_to_copy, {});
        assert.notDeepStrictEqual(diff2.src_cont_token, '');
        assert.notDeepStrictEqual(diff2.dst_cont_token, '');
        assert.ok(diff1.src_cont_token !== diff2.src_cont_token);
        assert.ok(diff1.dst_cont_token !== diff2.dst_cont_token);
        // list object with  diff2.dst_cont_token and check that first item is d1

        const diff3 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', diff2.src_cont_token, diff2.dst_cont_token);
        console.log('check pagination44: ', diff3.keys_sizes_map_to_copy, diff3.src_cont_token, diff3.dst_cont_token);
        assert.deepStrictEqual(diff3.keys_sizes_map_to_copy, {});
        assert.deepStrictEqual(diff3.src_cont_token, '');
        assert.deepStrictEqual(diff3.dst_cont_token, '');

        await empty_bucket(s3_owner, bucket1, bucket1_keys);
        await empty_bucket(s3_owner, bucket2, bucket2_keys);
    });

    mocha.it('list_buckets_and_compare - 6 ', async function() {
        let src_keys = ['a1', 'a2', 'a3', 'a4', 'a5'];
        let dst_keys = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
        bucket1_keys = src_keys;
        bucket2_keys = dst_keys;
        for (let i = 0; i < src_keys.length; i++) {
            await put_object(s3_owner, bucket1, src_keys[i], src_keys[i]);
        }
        for (let i = 0; i < dst_keys.length; i++) {
            await put_object(s3_owner, bucket2, dst_keys[i], dst_keys[i]);
        }

        const diff1 = await scanner.list_buckets_and_compare(
            new SensitiveString(bucket1), new SensitiveString(bucket2), '', '', '');
        console.log('check pagination456: ', diff1.keys_sizes_map_to_copy, diff1.src_cont_token, diff1.dst_cont_token);
        assert.deepStrictEqual(Object.keys(diff1.keys_sizes_map_to_copy), src_keys);
        assert.deepStrictEqual(diff1.src_cont_token, '');
        assert.deepStrictEqual(diff1.dst_cont_token, '');

        await empty_bucket(s3_owner, bucket1, bucket1_keys);
        await empty_bucket(s3_owner, bucket2, bucket2_keys);
    });

});

async function put_replication(bucket_name, replication_policy, should_fail) {
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

/*async function create_namespace_buckets(admin_account) {
    try {
        const external_connection = {
            auth_method: 'AWS_V2',
            endpoint: coretest.get_http_address(),
            endpoint_type: 'S3_COMPATIBLE',
            identity: admin_account.access_keys[0].access_key.unwrap() || '123',
            secret: admin_account.access_keys[0].secret_key.unwrap() || 'abc',
        };

        await rpc_client.create_auth_token({
            email: EMAIL,
            password: PASSWORD,
            system: SYSTEM,
        });

        for (let i = 0; i < 2; i++) {
            const conn_name = `conn-repl${i}`;

            await rpc_client.account.add_external_connection({ ...external_connection, name: conn_name });

            const nsr_name = `nsr-repl${i}`;
            await rpc_client.pool.create_namespace_resource({
                name: nsr_name,
                connection: conn_name,
                target_bucket: 'first.bucket',
            });

            await rpc_client.bucket.create_bucket({
                name: `buck-repl${i}`,
                namespace: {
                    read_resources: [{ resource: nsr_name }],
                    write_resource: { resource: nsr_name }
                }
            });
        }
    } catch (err) {
        assert.fail(`create_namespace_buckets failed ${err}, ${err.stack}`);
    }
}*/

async function empty_bucket(s3_owner, bucket_name, keys_to_delete) {
    for (let i = 0; i < keys_to_delete.length; i++) {
        await delete_object(s3_owner, bucket_name, keys_to_delete[i]);
    }
}

function create_random_body() {
    return Math.random().toString(36).slice(7);
}

async function put_object(s3_owner, bucket_name, key, optional_body) {
    const res = await s3_owner.putObject({ Bucket: bucket_name, Key: key, Body: optional_body || create_random_body() }).promise();
    console.log('put_object: ', util.inspect(res));
}

async function list_objects(s3_owner, bucket_name) {
    const res = await s3_owner.listObjects({ Bucket: bucket_name }).promise();
    console.log('list_objects: ', util.inspect(res));
    return res;
}

async function delete_object(s3_owner, bucket_name, key) {
    const res = await s3_owner.deleteObject({ Bucket: bucket_name, Key: key }).promise();
    console.log('delete_object: ', util.inspect(res));
}
async function list_objects_and_wait(s3_owner, bucket, expected_num_of_objects) {
    let res;
    for (let retries = 1; retries <= 3; retries++) {
        try {
            res = await list_objects(s3_owner, bucket);
            console.log('list_objects_and_wait: ', res);
            assert.deepStrictEqual(res.Contents.length, expected_num_of_objects);
            console.log(`list_objects contents: expected: ${expected_num_of_objects} actual: ${res.Contents.length} ${res.Contents}`);
            return res.Contents;
        } catch (e) {
            console.log(`waiting for replications of bucket: ${bucket}, response: ${util.inspect(res)} `); //num of retries: ${retries}`);
            if (retries === 3) throw e;
            await P.delay(2 * 1000);
        }
    }
}
