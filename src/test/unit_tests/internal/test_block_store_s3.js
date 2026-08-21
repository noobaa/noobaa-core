/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const { Readable } = require('stream');

const SensitiveString = require('../../../util/sensitive_string');
const { BlockStoreS3 } = require('../../../agent/block_store_services/block_store_s3');

/**
 * Builds a BlockStoreS3 with a stub S3 client so tests never hit the network.
 */
function make_store({ getObjectBody, putObject } = {}) {
    const store = new BlockStoreS3({
        node_name: 'test-s3-node',
        rpc_client: {},
        cloud_info: {
            endpoint: 'https://s3.amazonaws.com',
            target_bucket: 'test-bucket',
            auth_method: 'AWS_V4',
            access_keys: {
                access_key: new SensitiveString('AKIATEST'),
                secret_key: new SensitiveString('secret'),
            },
        },
        cloud_path: 'noobaa_blocks/test',
    });
    store.s3cloud = {
        getObject: async () => ({
            Body: typeof getObjectBody === 'function' ? getObjectBody() : getObjectBody,
            Metadata: {},
        }),
        putObject: putObject || (async () => ({})),
    };
    store.disable_metadata = true;
    return store;
}

/**
 * Mimics AWS SDK v3 getObject Body: a Node Readable with SdkStreamMixin helpers.
 */
function make_sdk_v3_body(buf) {
    const body = Readable.from(buf);
    body.transformToByteArray = async () => new Uint8Array(buf);
    return body;
}

mocha.describe('BlockStoreS3 _read_block SDK v3 body', function() {

    const data = Buffer.from('mirror-block-payload');
    const digest_b64 = crypto.createHash('sha1').update(data).digest('base64');
    const block_md = {
        id: 'abc123def',
        size: data.length,
        digest_type: 'sha1',
        digest_b64,
    };

    mocha.it('accepts a Buffer Body (SDK v2 shape)', async function() {
        const store = make_store({ getObjectBody: data });
        const block = await store._read_block_and_verify(block_md);
        assert.ok(Buffer.isBuffer(block.data));
        assert.ok(data.equals(block.data));
    });

    mocha.it('converts an SDK v3 stream Body to a Buffer', async function() {
        const store = make_store({ getObjectBody: () => make_sdk_v3_body(data) });
        const block = await store._read_block_and_verify(block_md);
        assert.ok(Buffer.isBuffer(block.data), `expected Buffer, got ${block.data && block.data.constructor && block.data.constructor.name}`);
        assert.ok(data.equals(block.data));
    });

    mocha.it('replicate_block writes a Buffer to the target store', async function() {
        const puts = [];
        const source_store = make_store({ getObjectBody: () => make_sdk_v3_body(data) });
        const target_store = make_store({
            getObjectBody: data,
            putObject: async params => {
                puts.push(params);
                return {};
            },
        });
        target_store.client = {
            block_store: {
                read_block: async (params, options) => source_store.read_block({ rpc_params: params }),
            },
        };
        const target_md = { ...block_md, id: 'target-block-id' };
        await target_store.replicate_block({
            rpc_params: {
                target: target_md,
                source: { ...block_md, address: 'n2n://source' },
            },
        });
        assert.strictEqual(puts.length, 1);
        assert.ok(Buffer.isBuffer(puts[0].Body), `putObject Body ctor=${puts[0].Body && puts[0].Body.constructor && puts[0].Body.constructor.name}`);
        assert.ok(data.equals(puts[0].Body));
    });

    mocha.it('init decodes usage from an SDK v3 stream Body when metadata is disabled', async function() {
        const expected_usage = { size: 1234, count: 5 };
        const usage_body = Buffer.from(JSON.stringify(expected_usage)).toString('base64');
        const store = make_store({
            getObjectBody: () => make_sdk_v3_body(Buffer.from(usage_body)),
        });
        await store.init();
        assert.deepStrictEqual(store._usage, expected_usage);
    });
});
