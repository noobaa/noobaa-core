/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const util = require('util');
const mocha = require('mocha');
const assert = require('assert');

// const P = require('../../util/promise');
const MDStore = require('../../server/object_services/md_store').MDStore;
const map_writer = require('../../server/object_services/map_writer');
const system_store = require('../../server/system_services/system_store').get_instance();

coretest.describe_mapper_test_case({
    name: 'map_writer',
    bucket_name_prefix: 'test-map-writer',
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
    if (data_placement !== 'SPREAD' || num_pools !== 1 || total_blocks > 10) return;

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

});
