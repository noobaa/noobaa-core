/* Copyright (C) 2020 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const _ = require('lodash');
const P = require('../../../../util/promise');
const coretest = require('../../../utils/coretest/coretest');
const { rpc_client } = coretest; //, PASSWORD, SYSTEM
const { BucketLogUploader } = require('../../../../server/bg_services/bucket_logs_upload');

coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

mocha.describe('noobaa bucket logging configuration validity tests', function() {
    const source1 = 'source-bucket-1';
    const source2 = 'source-bucket-2';
    const log1 = 'log-bucket';

    const no_log_bucket = 'no-log-bucket';
    const no_source_bucket = 'no-source-bucket';

    const log_prefix_1 = 'xxxxx/';
    const log_prefix_2 = 'yyyyy/';
    const no_log_prefix = '';

    const buckets = [source1, source2, log1];

    mocha.before('create buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.create_bucket({ name: bucket_name });
        }));
    });

    mocha.after('delete buckets', async function() {
        await P.all(_.map(buckets, async bucket_name => {
            await rpc_client.bucket.delete_bucket({ name: bucket_name });
        }));
    });

    mocha.it('_put_bucket_logging - all parameter provided - should not fail', async function() {
        await _put_bucket_logging(source1, log1, log_prefix_1, false, "");
    });

    mocha.it('_put_bucket_logging - log prefix not provided - should not fail', async function() {
        await _put_bucket_logging(source1, log1, no_log_prefix, false, "");
    });

    mocha.it('_put_bucket_logging - log bucket does not exist - should fail', async function() {
        await _put_bucket_logging(source2, no_log_bucket, log_prefix_1, true, "INVALID_TARGET_BUCKET");
    });

    mocha.it('_put_bucket_logging - source bucket does not exist - should fail', async function() {
        await _put_bucket_logging(no_source_bucket, log1, log_prefix_1, true, "NO_SUCH_BUCKET");
    });

    mocha.it('_put_bucket_logging - second source bucket configured with same log bucket - should not fail', async function() {
        await _put_bucket_logging(source2, log1, log_prefix_2, false, "");
    });

    mocha.it('_get bucket logging ', async function() {
        await _get_bucket_logging(source1, false, "");
    });

    mocha.it('_get bucket logging ', async function() {
        await _get_bucket_logging(no_source_bucket, true, "NO_SUCH_BUCKET");
    });

    mocha.it('get bucket owner keys ', async function() {
        const uploader = new BucketLogUploader({
            name: 'Bucket Log Uploader',
            client: rpc_client,
        });
        const uploader_keys = await uploader.get_bucket_owner_keys(source1);
        const bucket = await rpc_client.bucket.read_bucket({ name: source1 });
        const owner = await rpc_client.account.read_account({ email: bucket.owner_account.email });
        assert.strictEqual(uploader_keys[0].access_key, owner.access_keys[0].access_key.unwrap());
        assert.strictEqual(uploader_keys[0].secret_key, owner.access_keys[0].secret_key.unwrap());
    });
});

async function _put_bucket_logging(source_bucket_name, log_bucket_name, log_prefix, should_fail, error_message) {
    try {
        await rpc_client.bucket.put_bucket_logging({ name: source_bucket_name, logging:
            { log_bucket: log_bucket_name, log_prefix: log_prefix }
        });
        if (should_fail) {
            assert.fail(`put_bucket_logging should fail but it passed`);
        }
    } catch (err) {
        if (should_fail) {
            assert.deepStrictEqual(err.rpc_code, error_message);
            return;
        }
        assert.fail(`put_bucket_logging failed ${err}, ${err.stack}`);
    }
}

async function _get_bucket_logging(source_bucket_name, should_fail, error_message) {
    try {
        await rpc_client.bucket.get_bucket_logging({ name: source_bucket_name});
        if (should_fail) {
            assert.fail(`get_bucket_logging should fail but it passed`);
        }
    } catch (err) {
        if (should_fail) {
            assert.deepStrictEqual(err.rpc_code, error_message);
            return;
        }
        assert.fail(`get_bucket_logging failed ${err}, ${err.stack}`);
    }
}
