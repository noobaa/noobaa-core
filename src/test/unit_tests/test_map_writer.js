/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
// const mongodb = require('mongodb');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../../server/object_services/md_store').MDStore;
// const config = require('../../../config.js');
const map_writer = require('../../server/object_services/map_writer');
const system_store = require('../../server/system_services/system_store').get_instance();

mocha.describe('map_writer', function() {

    const { rpc_client } = coretest;
    const BKT = 'test-map-writer';
    const chunk_coder_config = {};

    mocha.before(function() {
        return P.resolve()
            .then(() => rpc_client.bucket.create_bucket({
                name: BKT,
                chunk_coder_config,
            }));
    });

    mocha.describe('allocate_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[BKT];
            const obj = {};
            const parts = [{
                start: 0,
                end: 100,
                chunk: {
                    chunk_coder_config: {},
                    size: 100,
                    frag_size: 100,
                    digest_b64: Buffer.from('abcdefg').toString('base64'),
                    frags: [{
                        data_index: 0,
                    }]
                }
            }];
            return map_writer.allocate_object_parts(bucket, obj, parts)
                .then(res => {
                    console.log('allocate_object_parts =>>>>', util.inspect(res, true, null, true));
                    assert.strictEqual(res.parts.length, 1);
                    const part = res.parts[0];
                    const frag = part.chunk.frags[0];
                    assert.strictEqual(frag.blocks.length, 3);
                    assert(_.every(frag.blocks, b =>
                        b.block_md && b.block_md.id && b.block_md.address && b.block_md.node));
                });
        });
    });

    mocha.describe('finalize_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[BKT];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            const parts = [{
                start: 0,
                end: 100,
                chunk: {
                    chunk_coder_config: bucket.tiering.tiers[0].tier.chunk_config.chunk_coder_config,
                    size: 100,
                    frag_size: 100,
                    frags: [{
                        data_index: 0,
                        blocks: [{
                            block_md: { id: MDStore.instance().make_md_id() }
                        }, {
                            block_md: { id: MDStore.instance().make_md_id() }
                        }, {
                            block_md: { id: MDStore.instance().make_md_id() }
                        }],
                    }]
                }
            }];
            return map_writer.finalize_object_parts(bucket, obj, parts);
        });
    });

    mocha.describe('complete_object_parts', function() {
        mocha.it('works', function() {
            const obj = {
                _id: MDStore.instance().make_md_id(),
            };
            const multiparts_req = undefined;
            return map_writer.complete_object_parts(obj, multiparts_req);
        });
    });

});
