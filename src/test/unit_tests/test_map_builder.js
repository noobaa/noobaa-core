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


    mocha.it('builds missing frags', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj = await make_object();
        await delete_blocks_keep_minimal_frags(obj);
        const builder = new map_builder.MapBuilder();
        await builder.run(obj.chunk_ids);
        await load_chunks(obj);
        await assert_fully_built(obj);
    });

    mocha.it('builds missing frags with another rebuild failure in the batch', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj1 = await make_object();
        const obj2 = await make_object();
        await delete_blocks_keep_minimal_frags(obj1);
        await delete_blocks(_.flatMap(obj2.chunks, 'blocks'));
        const chunk_ids = _.concat(obj1.chunk_ids, obj2.chunk_ids);
        const builder = new map_builder.MapBuilder();
        try {
            await builder.run(chunk_ids);
            assert.fail('builder should have failed');
        } catch (err) {
            assert.strictEqual(err.message, 'MapBuilder had errors');
        }
        await load_chunks(obj1);
        await assert_fully_built(obj1);
    });

    mocha.it('builds missing replicas', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj = await make_object();
        await delete_blocks_keep_minimal_replicas(obj);
        const builder = new map_builder.MapBuilder();
        await builder.run(obj.chunk_ids);
        await load_chunks(obj);
        await assert_fully_built(obj);
    });

    mocha.it('does nothing for good object', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj_before = await make_object();
        const obj_after = { ...obj_before };
        const builder = new map_builder.MapBuilder();
        await builder.run(obj_before.chunk_ids);
        await load_chunks(obj_after);
        await assert_fully_built(obj_after);
        const blocks_before = _.flatMap(obj_before.chunks, chunk => _.map(chunk.blocks, block => String(block._id))).sort();
        const blocks_after = _.flatMap(obj_after.chunks, chunk => _.map(chunk.blocks, block => String(block._id))).sort();
        assert.deepStrictEqual(blocks_after, blocks_before);
        assert(blocks_before.length >= obj_before.chunks.length, 'blocks_before.length >= obj_before.chunks.length');
    });

    ///////////////
    // FUNCTIONS //
    ///////////////


    async function make_object() {
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
        await object_io.upload_object(params);
        const chunk_ids = await MDStore.instance().find_parts_chunk_ids({
            _id: MDStore.instance().make_md_id(params.obj_id)
        });
        const obj = {
            bucket,
            key,
            size,
            obj_id: params.obj_id,
            data,
            chunk_ids,
        };
        await load_chunks(obj);
        return obj;
    }

    async function load_chunks(obj) {
        const chunks = await MDStore.instance().find_chunks_by_ids(obj.chunk_ids);
        await MDStore.instance().load_blocks_for_chunks(chunks);
        obj.chunks = chunks;
    }

    async function delete_blocks_keep_minimal_frags(obj) {
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

    async function delete_blocks_keep_minimal_replicas(obj) {
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

    async function delete_blocks(blocks) {
        console.log('Deleting blocks', blocks.map(block => _.pick(block, '_id', 'size', 'frag')));
        return P.join(
            map_deleter.delete_blocks_from_nodes(blocks),
            MDStore.instance().update_blocks_by_ids(_.map(blocks, '_id'), { deleted: new Date() })
        );
    }

    async function assert_fully_built(obj) {
        const { key, data, chunks, obj_id } = obj;
        _.forEach(chunks, chunk => {
            console.log('Checking chunk fully built', chunk);
            const tiering = system_store.data.systems[0].buckets_by_name[bucket].tiering;
            const tiering_status = _.fromPairs(_.map(tiering.tiers,
                ({ tier, spillover }) => [tier._id, {
                    pools: _.fromPairs(_.map(system_store.data.pools,
                        pool => [pool._id, { valid_for_allocation: true, num_nodes: 1000 }]
                    )),
                    mirrors_storage: tier.mirrors.map(mirror => ({
                        free: { peta: 2, n: 0 },
                        regular_free: { peta: 1, n: 0 },
                        redundant_free: { peta: 1, n: 0 },
                    }))
                }]
            ));
            chunk.chunk_coder_config = chunk_coder_config;
            const select_tier = mapper.select_tier_for_write(tiering, tiering_status);
            const mapping = mapper.map_chunk(chunk, select_tier, tiering, tiering_status);
            console.log('Chunk mapping', mapping);
            assert.strictEqual(mapping.allocations, undefined);
            assert.strictEqual(mapping.deletions, undefined);
            assert.strictEqual(mapping.missing_frags, undefined);
        });

        const read_data = await object_io.read_entire_object({ client: rpc_client, bucket, key, obj_id });

        assert.deepStrictEqual(read_data, data);
    }

});
