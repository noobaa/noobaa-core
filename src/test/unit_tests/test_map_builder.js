/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
// const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');

const P = require('../../util/promise');
const mapper = require('../../server/object_services/mapper');
const MDStore = require('../../server/object_services/md_store').MDStore;
const ObjectIO = require('../../sdk/object_io');
// const map_writer = require('../../server/object_services/map_writer');
const map_builder = require('../../server/object_services/map_builder');
const map_deleter = require('../../server/object_services/map_deleter');
const SliceReader = require('../../util/slice_reader');
const system_store = require('../../server/system_services/system_store').get_instance();

const { rpc_client } = coretest;
const object_io = new ObjectIO();
object_io.set_verification_mode();

const seed = crypto.randomBytes(16);
const generator = crypto.createCipheriv('aes-128-gcm', seed, Buffer.alloc(12));

coretest.describe_mapper_test_case({
    name: 'map_builder',
    bucket_name_prefix: 'test-map-builder',
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

    // UNCOMMENT FOR MANUAL TEST OF EC ONLY:
    // if (data_frags !== 4 || parity_frags !== 2 || replicas !== 1) return;

    const bucket = bucket_name;
    const KEY = 'test-map-builder-key';

    let key_counter = 1;


    ///////////
    // TESTS //
    ///////////


    mocha.it('builds missing frags', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        let obj = {};
        return make_object(obj)
            .then(() => delete_blocks_keep_minimal_frags(obj))
            .then(() => new map_builder.MapBuilder(obj.chunk_ids).run())
            .then(() => load_chunks(obj))
            .then(() => assert_fully_built(obj));
    });

    mocha.it('builds missing replicas', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        let obj = {};
        return make_object(obj)
            .then(() => delete_blocks_keep_minimal_replicas(obj))
            .then(() => new map_builder.MapBuilder(obj.chunk_ids).run())
            .then(() => load_chunks(obj))
            .then(() => assert_fully_built(obj));
    });

    mocha.it('does nothing for good object', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        let obj_before = {};
        let obj_after = {};
        return make_object(obj_before)
            .then(() => Object.assign(obj_after, obj_before))
            .then(() => new map_builder.MapBuilder(obj_before.chunk_ids).run())
            .then(() => load_chunks(obj_after))
            .then(() => assert_fully_built(obj_after))
            .then(() => {
                const blocks_before = _.flatMap(obj_before.chunks, chunk => _.map(chunk.blocks, block => String(block._id))).sort();
                const blocks_after = _.flatMap(obj_after.chunks, chunk => _.map(chunk.blocks, block => String(block._id))).sort();
                assert.deepStrictEqual(blocks_after, blocks_before);
                assert(blocks_before.length >= obj_before.chunks.length, 'blocks_before.length >= obj_before.chunks.length');
            });
    });

    ///////////////
    // FUNCTIONS //
    ///////////////


    function make_object(obj) {
        const size = 1000;
        const data = generator.update(Buffer.alloc(size));
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const params = {
            client: rpc_client,
            bucket,
            key,
            size,
            content_type: 'application/octet-stream',
            source_stream: new SliceReader(data),
        };
        return P.resolve()
            .then(() => object_io.upload_object(params))
            .then(() => MDStore.instance().find_parts_chunk_ids({
                _id: MDStore.instance().make_md_id(params.obj_id)
            }))
            .then(chunk_ids => Object.assign(obj, {
                bucket,
                key,
                size,
                obj_id: params.obj_id,
                data,
                chunk_ids,
            }))
            .then(() => load_chunks(obj));
    }

    function load_chunks(obj) {
        return P.resolve()
            .then(() => MDStore.instance().find_chunks_by_ids(obj.chunk_ids))
            .then(chunks => MDStore.instance().load_blocks_for_chunks(chunks))
            .then(chunks => {
                obj.chunks = chunks;
            });
    }

    function delete_blocks_keep_minimal_frags(obj) {
        const { chunks } = obj;
        const blocks_to_delete = [];
        _.forEach(chunks, chunk => {
            console.log('Keeping minimal frags in chunk', chunk);
            const frags_by_id = _.keyBy(chunk.frags, '_id');
            const frags_to_delete = new Set(_.sampleSize(chunk.frags, parity_frags));
            _.forEach(chunk.blocks, block => {
                const frag = frags_by_id[block.frag];
                if (frags_to_delete.has(frag)) {
                    block.frag = frag;
                    blocks_to_delete.push(block);
                }
            });
        });
        return delete_blocks(blocks_to_delete);
    }

    function delete_blocks_keep_minimal_replicas(obj) {
        const { chunks } = obj;
        const blocks_to_delete = [];
        _.forEach(chunks, chunk => {
            console.log('Keeping minimal replicas in chunk', chunk);
            const frags_by_id = _.keyBy(chunk.frags, '_id');
            const blocks_by_frag_id = _.groupBy(chunk.blocks, 'frag');
            _.forEach(blocks_by_frag_id, (blocks, frag_id) => {
                _.forEach(blocks.slice(1), block => {
                    block.frag = frags_by_id[block.frag];
                    blocks_to_delete.push(block);
                });
            });
        });
        return delete_blocks(blocks_to_delete);
    }

    function delete_blocks(blocks) {
        console.log('Deleting blocks', blocks.map(block => _.pick(block, '_id', 'size', 'frag')));
        return P.join(
            map_deleter.delete_blocks_from_nodes(blocks),
            MDStore.instance().update_blocks_by_ids(_.map(blocks, '_id'), { deleted: new Date() })
        );
    }

    function assert_fully_built(obj) {
        const { key, data, chunks } = obj;
        _.forEach(chunks, chunk => {
            console.log('Checking chunk fully built', chunk);
            const tiering = system_store.data.systems[0].buckets_by_name[bucket].tiering;
            const tiering_status = _.fromPairs(_.map(tiering.tiers,
                ({ tier, spillover }) => [tier._id, {
                    pools: _.fromPairs(_.map(system_store.data.pools,
                        pool => [pool._id, { valid_for_allocation: true, num_nodes: 1000 }]
                    )),
                    mirrors_storage: tier.mirrors.map(mirror => ({ free: { peta: 1, n: 0 } }))
                }]
            ));
            chunk.chunk_coder_config = chunk_coder_config;
            const mapping = mapper.map_chunk(chunk, tiering, tiering_status);
            console.log('Chunk mapping', mapping);
            assert.strictEqual(mapping.allocations, undefined);
            assert.strictEqual(mapping.deletions, undefined);
            assert.strictEqual(mapping.extra_allocations, undefined);
            assert.strictEqual(mapping.missing_frags, undefined);
        });
        return object_io.read_entire_object({ client: rpc_client, bucket, key })
            .then(read_data => assert.deepStrictEqual(read_data, data));
    }

});
