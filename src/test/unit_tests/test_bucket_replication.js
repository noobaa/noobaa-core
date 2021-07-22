/* Copyright (C) 2020 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const _ = require('lodash');
const P = require('../../util/promise');
const coretest = require('./coretest');
const { rpc_client } = coretest;
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

        assert.ok(res[0].rule_id === 'rule-1' && res[0].destination_bucket.unwrap() === bucket1 && res[0].filter.prefix === '');
        assert.ok(res[1].rule_id === 'rule-2' && res[1].destination_bucket.unwrap() === first_bucket && res[1].filter.prefix === 'ab');
    });

    mocha.it('put_replication 4 - valid', async function() {
        await put_replication(bucket1, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, filter: { prefix: '' } }
        ], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res[0].rule_id === 'rule-1' && res[0].destination_bucket.unwrap() === first_bucket && res[0].filter.prefix === '');
    });

    mocha.it('put_replication 5 - valid', async function() {
        await put_replication(bucket1, [{ rule_id: 'rule-1', destination_bucket: first_bucket }], false);
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res[0].rule_id === 'rule-1' && res[0].destination_bucket.unwrap() === first_bucket);
    });

    mocha.it('put_replication - same rule_id - should fail ', async function() {
        await put_replication(bucket1, [
            { rule_id: 'rule-1', destination_bucket: first_bucket, filter: { prefix: 'b' } },
            { rule_id: 'rule-1', destination_bucket: bucket2, filter: { prefix: 'a' } }
        ], true);
    });

    mocha.it('get_bucket_replication ', async function() {
        const res = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        assert.ok(res[0].rule_id === 'rule-1' && res[0].destination_bucket.unwrap() === first_bucket);
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
            assert.ok(res[0].rule_id === 'rule-1' && res[0].destination_bucket.unwrap() === first_bucket);
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
        assert.ok(repl_buck2[0].rule_id === 'rule-1' && repl_buck2[0].destination_bucket.unwrap() === first_bucket);
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
            assert.ok(res[0].rule_id === 'rule-2' && res[0].destination_bucket.unwrap() === first_bucket);
        }));
    });

    mocha.it('update bucket replication of bucket1', async function() {
        await put_replication(bucket1, [{ rule_id: 'rule-3', destination_bucket: first_bucket }], false);
        const repl_buck1 = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        const repl_buck2 = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });
        assert.ok(repl_buck1[0].rule_id === 'rule-3');
        assert.ok(repl_buck2[0].rule_id === 'rule-2');

        const repl1 = ((await rpc_client.bucket.read_bucket({ name: bucket1 })).replication_policy_id);
        const repl2 = ((await rpc_client.bucket.read_bucket({ name: bucket2 })).replication_policy_id);
        assert.ok(repl1 !== repl2);
    });

    mocha.it('update bucket replication of bucket2', async function() {
        await put_replication(bucket2, [{ rule_id: 'rule-3', destination_bucket: first_bucket }], false);
        const repl_buck1 = await rpc_client.bucket.get_bucket_replication({ name: bucket1 });
        const repl_buck2 = await rpc_client.bucket.get_bucket_replication({ name: bucket2 });
        assert.ok(repl_buck1[0].rule_id === 'rule-3');
        assert.ok(repl_buck2[0].rule_id === 'rule-3');

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
async function put_replication(bucket_name, replication_policy, should_fail) {
    try {
        await rpc_client.bucket.put_bucket_replication({ name: bucket_name, replication_policy });
        if (should_fail) {
            assert.fail(`put_bucket_replication should fail but it passed`);
        }
    } catch (err) {
        if (should_fail) {
            assert.ok(err.rpc_code === 'INVALID_REPLICATION_POLICY');
            return;
        }
        assert.fail(`put_bucket_replication failed ${err}, ${err.stack}`);
    }
}
