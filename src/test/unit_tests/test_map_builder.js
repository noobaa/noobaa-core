/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('./nb')} nb */

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
// const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const config = require('../../../config');

const MDStore = require('../../server/object_services/md_store').MDStore;
const ObjectIO = require('../../sdk/object_io');
// const map_writer = require('../../server/object_services/map_writer');
const { MapBuilder } = require('../../server/object_services/map_builder');
const { ChunkDB } = require('../../server/object_services/map_db_types');
const { get_all_chunks_blocks } = require('../../sdk/map_api_types');
const map_deleter = require('../../server/object_services/map_deleter');
const map_reader = require('../../server/object_services/map_reader');
const SliceReader = require('../../util/slice_reader');

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

    // TODO REMOVE ME
    if (data_placement !== 'SPREAD' || num_pools !== 1 || replicas !== 1 || data_frags !== 4 || parity_frags !== 2) return;

    // TODO we need to create more nodes and pools to support all MAPPER_TEST_CASES
    if (total_blocks > 10) return;


    // UNCOMMENT FOR MANUAL TEST OF EC ONLY:
    // if (data_frags !== 4 || parity_frags !== 2 || replicas !== 1) return;

    const bucket = bucket_name;
    const KEY = 'test-map-builder-key';

    let key_counter = 1;


    ///////////
    // TESTS //
    ///////////

    mocha.it('evict object', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        config.NAMESPACE_CACHING.MIN_OBJECT_AGE_FOR_GC = 1;
        const obj = await make_object();

        const builder = new MapBuilder(obj.chunk_ids, undefined, true);
        await builder.run();

        const object_id = MDStore.instance().make_md_id(obj.obj_id);
        const afterObject = await MDStore.instance().find_object_by_id(object_id);
        const chunks = await MDStore.instance().find_chunks_by_ids(obj.chunk_ids);
        const parts = await MDStore.instance().find_all_parts_of_object(afterObject);

        assert.notStrictEqual(afterObject.deleted, undefined, 'Object should be marked deleted');
        assert.equal(chunks.filter(chunk => !chunk.deleted).length, 0, 'All chunks should be gone');
        assert.strictEqual(parts.length, 0, 'All parts should be deleted');
    });
    mocha.it('evict object partial', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        config.NAMESPACE_CACHING.MIN_OBJECT_AGE_FOR_GC = 1;
        const obj = await make_object();
        const object_id = MDStore.instance().make_md_id(obj.obj_id);

        const beforeObject = await MDStore.instance().find_object_by_id(object_id);
        const beforeParts = await MDStore.instance().find_all_parts_of_object(beforeObject);
        const chunks_to_delete = obj.chunk_ids.slice(obj.chunk_ids.length - 1);

        const builder = new MapBuilder(chunks_to_delete, undefined, true);
        await builder.run();

        const afterObject = await MDStore.instance().find_object_by_id(object_id);
        const chunks = await MDStore.instance().find_chunks_by_ids(obj.chunk_ids);
        const afterParts = await MDStore.instance().find_all_parts_of_object(afterObject);

        assert.strictEqual(afterObject.deleted, undefined, 'Object is not deleted');
        assert.equal(chunks.filter(chunk => chunk.deleted).length, 1, 'One chunk is deleted');
        assert.strictEqual(afterParts.length, beforeParts.length - 1, 'All parts should be deleted');
    });

    mocha.it('builds missing frags', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj = await make_object();
        await delete_blocks_keep_minimal_frags(obj);
        const builder = new MapBuilder(obj.chunk_ids);
        await builder.run();
        await load_chunks(obj);
        await assert_fully_built(obj);
    });

    mocha.it('builds missing frags with another rebuild failure in the batch', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj1 = await make_object();
        const obj2 = await make_object();
        await delete_blocks_keep_minimal_frags(obj1);
        await delete_blocks(get_all_chunks_blocks(obj2.chunks));
        const chunk_ids = _.concat(obj1.chunk_ids, obj2.chunk_ids);
        const builder = new MapBuilder(chunk_ids);
        try {
            await builder.run();
            assert.fail('builder should have failed');
        } catch (err) {
            assert.strictEqual(err.message, 'MapBuilder map errors');
        }
        await load_chunks(obj1);
        await assert_fully_built(obj1);
    });

    mocha.it('builds missing replicas', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj = await make_object();
        await delete_blocks_keep_minimal_replicas(obj);
        const builder = new MapBuilder(obj.chunk_ids);
        await builder.run();
        await load_chunks(obj);
        await assert_fully_built(obj);
    });

    mocha.it('does nothing for good object', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const obj_before = await make_object();
        const obj_after = { ...obj_before };
        const builder = new MapBuilder(obj_before.chunk_ids);
        await builder.run();
        await load_chunks(obj_after);
        await assert_fully_built(obj_after);
        const blocks_before = get_all_chunks_blocks(obj_before.chunks).map(block => String(block._id)).sort();
        const blocks_after = get_all_chunks_blocks(obj_after.chunks).map(block => String(block._id)).sort();
        assert.deepStrictEqual(blocks_after, blocks_before);
        assert(blocks_before.length >= obj_before.chunks.length, 'blocks_before.length >= obj_before.chunks.length');
    });

    ///////////////
    // FUNCTIONS //
    ///////////////

    /**
     * @typedef {Object} BuilderObject
     * @property {string} bucket
     * @property {string} key
     * @property {number} size
     * @property {nb.ID} obj_id
     * @property {Buffer} data
     * @property {nb.ID[]} chunk_ids
     * @property {nb.ChunkSchemaDB[]} chunks
     */

    /**
     * @returns {BuilderObject}
     */
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
            chunks: undefined,
        };
        await load_chunks(obj);
        return obj;
    }

    /**
     * @param {BuilderObject} obj
     */
    async function load_chunks(obj) {
        const chunks = await MDStore.instance().find_chunks_by_ids(obj.chunk_ids);
        await MDStore.instance().load_blocks_for_chunks(chunks);
        obj.chunks = chunks.map(chunk => new ChunkDB(chunk));
    }

    /**
     * @param {BuilderObject} obj
     */
    async function delete_blocks_keep_minimal_frags(obj) {
        const { chunks } = obj;
        const blocks_to_delete = [];
        _.forEach(chunks, chunk => {
            coretest.log('Keeping minimal frags in chunk', chunk._id);
            const frags_to_delete = new Set(_.sampleSize(chunk.frags, parity_frags));
            _.forEach(frags_to_delete, frag => {
                _.forEach(frag.blocks, block => {
                    blocks_to_delete.push(block);
                });
            });
        });
        return delete_blocks(blocks_to_delete);
    }

    async function delete_blocks_keep_minimal_replicas(obj) {
        const { chunks } = obj;
        const blocks_to_delete = [];
        _.forEach(chunks, chunk => {
            coretest.log('Keeping minimal replicas in chunk', chunk._id);
            _.forEach(chunk.frags, frag => {
                _.forEach(frag.blocks.slice(1), block => {
                    blocks_to_delete.push(block);
                });
            });
        });
        return delete_blocks(blocks_to_delete);
    }

    async function delete_blocks(blocks) {
        coretest.log('Deleting blocks', blocks.map(block => _.pick(block, '_id', 'size', 'frag.id')));
        return Promise.all([
            map_deleter.delete_blocks_from_nodes(blocks),
            MDStore.instance().update_blocks_by_ids(_.map(blocks, '_id'), { deleted: new Date() })
        ]);
    }

    /**
     *
     * @param {BuilderObject} obj
     */
    async function assert_fully_built(obj) {
        const chunks = await map_reader.read_object_mapping({ _id: MDStore.instance().make_md_id(obj.obj_id) });
        _.forEach(chunks, chunk => {
            chunk.frags.forEach(frag => {
                assert.strictEqual(frag.allocations.length, 0);
                const deletions = frag.blocks.filter(block => block.is_deletion || block.is_future_deletion);
                assert.strictEqual(deletions.length, 0);
            });
        });

        const read_data = await object_io.read_entire_object({ client: rpc_client, object_md: obj });

        assert.deepStrictEqual(read_data, obj.data);
    }

});
