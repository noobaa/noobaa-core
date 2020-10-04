/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const argv = require('minimist')(process.argv);
const crypto = require('crypto');
const P = require('../util/promise');
const api = require('../api');
const dbg = require('../util/debug_module')(__filename);
const system_store = require('../server/system_services/system_store').get_instance();
const node_allocator = require('../server/node_services/node_allocator');
const db_client = require('../util/db_client');

const rpc = api.new_rpc();
const client = rpc.new_client();

argv.email = argv.email || 'demo@noobaa.com';
argv.password = argv.password || 'DeMo1';
argv.system = argv.system || 'demo';
argv.bucket = argv.bucket || 'first.bucket';
argv.count = argv.count || 100;
argv.chunks = argv.chunks || 128;
argv.chunk_size = argv.chunk_size || 1024 * 1024;
argv.concur = argv.concur || 20;
argv.key = argv.key || ('md_blow-' + Date.now().toString(36));

main();

async function main() {
    try {
        await system_store.load();
        await client.create_auth_token({
            email: argv.email,
            password: argv.password,
            system: argv.system,
        });
        await blow_objects();
        process.exit(0);
    } catch (err) {
        dbg.error('FATAL', err);
        process.exit(1);
    }
}

async function blow_objects() {
    let index = 0;

    async function blow_serial() {
        while (index < argv.count) {
            index += 1;
            await blow_object(index);
        }
    }
    await P.all(_.times(argv.concur, blow_serial));
}

async function blow_object(index) {
    const params = {
        bucket: argv.bucket,
        key: argv.key + '-' + index,
        size: argv.chunks * argv.chunk_size,
        content_type: 'application/octet_stream'
    };
    dbg.log0('create_object_upload', params.key);
    const create_reply = await client.object.create_object_upload(params);
    params.obj_id = create_reply.obj_id;
    await blow_parts(params);
    let complete_params = _.pick(params, 'bucket', 'key', 'size', 'obj_id');
    complete_params.etag = 'bla';
    dbg.log0('complete_object_upload', params.key);
    await client.object.complete_object_upload(complete_params);
}

async function blow_parts(params) {
    try {
        dbg.log0('allocate_object_parts', params.key);
        const bucket = await client.bucket.read_bucket({ name: params.bucket });
        const bucket_db = _.find(system_store.data.buckets, b => (b.name.unwrap() === bucket.name.unwrap()));
        const [record] = bucket.tiering.tiers;
        const tier = await client.tier.read_tier({ name: record.tier });
        const tier_db = _.find(system_store.data.tiers, t => (t.name.unwrap() === tier.name.unwrap()));
        const pool_db = system_store.data.pools[0];
        await node_allocator.refresh_pool_alloc(pool_db);
        const node = node_allocator.allocate_node({
            pools: [pool_db]
        });
        await client.object.put_mapping({
            chunks: _.times(argv.chunks, i => ({
                bucket_id: bucket_db._id,
                tier_id: tier_db._id,
                chunk_coder_config: tier.chunk_coder_config,
                size: argv.chunk_size,
                frag_size: argv.chunk_size,
                compress_size: argv.chunk_size,
                digest_b64: crypto.randomBytes(32).toString('base64'),
                cipher_key_b64: crypto.randomBytes(32).toString('base64'),
                cipher_iv_b64: crypto.randomBytes(32).toString('base64'),
                frags: _.times(6, data_index => ({
                    data_index,
                    digest_b64: crypto.randomBytes(32).toString('base64'),
                    blocks: [],
                    allocations: [{
                        mirror_group: 'abc',
                        block_md: {
                            id: db_client.instance().new_object_id().toHexString(),
                            node: node._id,
                            pool: pool_db._id,
                            size: argv.chunk_size
                        },
                    }],
                })),
                parts: [{
                    start: i * argv.chunk_size,
                    end: (i + 1) * argv.chunk_size,
                    seq: i,
                    obj_id: params.obj_id,
                }],
            }))
        });
    } catch (err) {
        dbg.error('Test failed with following error', err);
    }
}
