/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

// const _ = require('lodash');
const mocha = require('mocha');
// const assert = require('assert');

// const P = require('../../util/promise');
// const MDStore = require('../../server/object_services/md_store').MDStore;
const { MapClient } = require('../../sdk/map_client');
const system_store = require('../../server/system_services/system_store').get_instance();
const db_client = require('../../util/db_client');
const { ChunkAPI } = require('../../sdk/map_api_types');

coretest.describe_mapper_test_case({
    name: 'map_client',
    bucket_name_prefix: 'test-map-client',
}, ({
    test_name,
    bucket_name,
    data_placement,
    num_pools,
    replicas,
    data_frags,
    parity_frags,
    total_frags,
    total_blocks,
    total_replicas,
    chunk_coder_config,
}) => {

    // TODO we need to create more nodes and pools to support all MAPPER_TEST_CASES
    if (data_placement !== 'SPREAD' || num_pools !== 1 || total_blocks !== 1) return;

    const { rpc_client, SYSTEM } = coretest;

    /** @type {nb.System} */
    let system;
    /** @type {nb.Bucket} */
    let bucket;
    /** @type {nb.NodeAPI[]} */
    const nodes = [];
    /** @type {{ [node_id: string]: nb.NodeAPI }} */
    const nodes_by_id = {};

    mocha.before(async function() {
        await system_store.load();
        system = system_store.data.systems_by_name[SYSTEM];
        bucket = system.buckets_by_name[bucket_name];
        const res = await rpc_client.node.list_nodes({});
        for (const node of res.nodes) {
            nodes.push(node);
            nodes_by_id[node._id] = node;
        }
    });

    mocha.it('works ok', async function() {
        const chunk = new ChunkAPI({
            bucket_id: String(bucket._id),
            tier_id: String(bucket.tiering.tiers[0].tier._id),
            chunk_coder_config: { replicas: 3 },
            size: 1,
            compress_size: 1,
            frag_size: 1,
            // digest_b64: '',
            // cipher_key_b64: '',
            // cipher_iv_b64: '',
            // cipher_auth_tag_b64: '',
            frags: [{
                data_index: 1,
                blocks: [{
                    block_md: {
                        id: db_client.instance().new_object_id(),
                        node: nodes[0]._id,
                        pool: system.pools_by_name[nodes[0].pool]._id,
                    }
                }]
            }],
            parts: []
        }, system_store);
        const mc = new MapClient({
            chunks: [chunk],
            rpc_client,
        });
        await mc.run();
    });


    /*
    mocha.describe('select_tier_for_write', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            return map_writer.select_tier_for_write(bucket, obj)
                .then(tier => {
                    assert.strictEqual(tier, bucket.tiering.tiers[0].tier);
                });
        });
    });

    mocha.describe('allocate_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            const parts = [{
                start: 0,
                end: 100,
                chunk: {
                    chunk_coder_config,
                    size: 100,
                    frag_size: 100,
                    digest_b64: Buffer.from('abcdefg').toString('base64'),
                    frags: _.concat(
                        _.times(data_frags, data_index => ({
                            data_index,
                        })),
                        _.times(parity_frags, parity_index => ({
                            parity_index,
                        }))
                    )
                }
            }];
            return map_writer.allocate_object_parts(bucket, obj, parts)
                .then(res => {
                    console.log('allocate_object_parts =>>>>', util.inspect(res, true, null, true));
                    assert.strictEqual(res.parts.length, 1);
                    const part = res.parts[0];
                    const frag = part.chunk.frags[0];
                    assert.strictEqual(frag.blocks.length, replicas);
                    assert(_.every(frag.blocks,
                        b => b.block_md && b.block_md.id && b.block_md.address && b.block_md.node
                    ));
                });
        });
    });

    mocha.describe('finalize_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            const parts = [{
                start: 0,
                end: 100,
                chunk: {
                    chunk_coder_config: bucket.tiering.tiers[0].tier.chunk_config.chunk_coder_config,
                    tier: bucket.tiering.tiers[0].tier.name,
                    size: 100,
                    frag_size: 100,
                    frags: _.concat(
                        _.times(data_frags, data_index => ({
                            data_index,
                            blocks: _.times(replicas, () => ({
                                block_md: {
                                    id: MDStore.instance().make_md_id(),
                                    node: MDStore.instance().make_md_id(),
                                    pool: MDStore.instance().make_md_id(),
                                }
                            }))
                        })),
                        _.times(parity_frags, parity_index => ({
                            parity_index,
                            blocks: _.times(replicas, () => ({
                                block_md: {
                                    id: MDStore.instance().make_md_id(),
                                    node: MDStore.instance().make_md_id(),
                                    pool: MDStore.instance().make_md_id(),
                                }
                            }))
                        }))
                    )
                }
            }];
            return map_writer.finalize_object_parts(bucket, obj, parts);
        });
    });

    mocha.describe('complete_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            return map_writer.complete_object_parts(obj);
        });
    });

    mocha.describe('complete_object_multiparts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            const multiparts_req = [];
            return map_writer.complete_object_parts(obj, multiparts_req);
        });
    });

    */

});
