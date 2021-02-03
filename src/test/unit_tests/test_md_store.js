/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const config = require('./../../../config');

// const P = require('../../util/promise');
const MDStore = require('../../server/object_services/md_store').MDStore;

mocha.describe('md_store', function() {

    const md_store = new MDStore(`_test_md_store_${Date.now().toString(36)}`);
    const system_id = md_store.make_md_id();
    const bucket_id = md_store.make_md_id();

    mocha.describe('objects', function() {

        mocha.it('insert/update/find_object()', async function() {
            let obj;
            const now = new Date();
            const info = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket_id,
                key: 'lala_' + now.getTime().toString(36),
                create_time: now,
                content_type: 'lulu_' + now.getTime().toString(36),
            };

            await md_store.insert_object(info);
            obj = await md_store.find_object_by_id(info._id);
            assert_equal(obj, info);

            await md_store.update_object_by_id(info._id, { size: 777 }, { upload_size: 1 }, { num_parts: 88 });
            obj = await md_store.find_object_latest(bucket_id, info.key);
            assert_equal(obj, _.defaults({ size: 777, num_parts: 88 }, info));

            await md_store.update_object_by_id(info._id, { deleted: new Date() });
            obj = await md_store.find_object_latest(bucket_id, info.key);
            assert_equal(obj, null);

            const res = await md_store.populate_objects({ obj: info._id }, 'obj', { key: 1, num_parts: 1 });
            assert_equal(res.obj.key, info.key);
            assert_equal(res.obj.num_parts, 88);
        });

        mocha.it('insert_object() detects missing key (bad schema)', async function() {
            const info = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket_id,
            };
            let err_message = 'error not detected';
            try {
                await md_store.insert_object(info);
            } catch (err) {
                err_message = err.message;
            }
            assert(err_message.startsWith('INVALID_SCHEMA_DB'), err_message);
        });

        mocha.it('find_objects()', async function() {
            return md_store.find_objects({ bucket_id });
        });

        mocha.it('find_objects_by_prefix()', async function() {
            return md_store.list_objects({
                bucket_id,
                prefix: '',
            });
        });

        mocha.it('list_objects()', async function() {
            return md_store.list_objects({
                bucket_id,
                prefix: '',
                delimiter: '/'
            });
        });

        mocha.it('had_any_objects_in_system()', async function() {
            return md_store.had_any_objects_in_system(system_id);
        });

        mocha.it('has_any_completed_objects_in_bucket()', async function() {
            return md_store.has_any_completed_objects_in_bucket(bucket_id);
        });

        mocha.it('count_objects_of_bucket()', async function() {
            return md_store.count_objects_of_bucket(bucket_id);
        });

        mocha.it('count_objects_per_bucket()', async function() {
            return md_store.count_objects_per_bucket(system_id);
        });

        mocha.it('aggregate_objects_by_create_dates()', async function() {
            const till_time = Date.now();
            const from_time = till_time - (24 * 3600 * 1000);
            return md_store.aggregate_objects_by_create_dates(from_time, till_time);
        });

        mocha.it('aggregate_objects_by_delete_dates()', async function() {
            const till_time = Date.now();
            const from_time = till_time - (24 * 3600 * 1000);
            return md_store.aggregate_objects_by_delete_dates(from_time, till_time);
        });

    });


    mocha.describe('multiparts', function() {

        const multipart = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: md_store.make_md_id(),
            obj: md_store.make_md_id(),
            num: 1,
        };

        mocha.it('insert_multipart()', async function() {
            return md_store.insert_multipart(multipart);
        });

        mocha.it('delete_multiparts_of_object()', async function() {
            const obj = { _id: multipart.obj };
            return md_store.delete_multiparts_of_object(obj);
        });

    });


    mocha.describe('parts', function() {

        const parts = [{
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: md_store.make_md_id(),
            obj: md_store.make_md_id(),
            chunk: md_store.make_md_id(),
            start: 0,
            end: 10,
            seq: 0,
        },
        {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: md_store.make_md_id(),
            obj: md_store.make_md_id(),
            chunk: md_store.make_md_id(),
            start: 0,
            end: 20,
            seq: 0,
        },
        {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: md_store.make_md_id(),
            obj: md_store.make_md_id(),
            chunk: md_store.make_md_id(),
            start: 0,
            end: 20,
            seq: 0,
        }];

        mocha.it('insert_parts()', async function() {
            return md_store.insert_parts(parts);
        });

        mocha.it('find_parts_by_start_range()', async function() {
            return md_store.find_parts_by_start_range({
                obj_id: parts[0].obj,
                start_gte: 0,
                start_lt: 10,
                end_gt: 5,
            });
        });

        mocha.it('find_parts_chunk_ids()', async function() {
            const obj = { _id: parts[0].obj };
            return md_store.find_parts_chunk_ids(obj);
        });

        mocha.it('find_parts_by_chunk_ids()', async function() {
            const chunk_ids = _.map(parts, 'chunk');
            return md_store.find_parts_by_chunk_ids(chunk_ids);
        });

        mocha.it('find_parts_unreferenced_chunk_ids()', async function() {
            const chunk_ids = _.map(parts, 'chunk');
            return md_store.find_parts_unreferenced_chunk_ids(chunk_ids);
        });

        mocha.it('find_parts_chunks_references()', async function() {
            const chunk_ids = _.map(parts, 'chunk');
            return md_store.find_parts_chunks_references(chunk_ids);
        });

        mocha.it('load_parts_objects_for_chunks()', async function() {
            const chunks = _.map(parts, part => ({ _id: part.chunk }));
            return md_store.load_parts_objects_for_chunks(chunks);
        });

        mocha.it('delete_parts_of_object()', async function() {
            const obj = { _id: parts[0].obj };
            return md_store.delete_parts_of_object(obj);
        });

        mocha.it('delete_parts_by_ids()', async function() {
            const part_ids = [ parts[1]._id ];
            return md_store.delete_parts_by_ids(part_ids);
        });

        mocha.it('has_any_parts_for_object exists', async function() {
            const obj = { _id: parts[2].obj };
            assert.equal(await md_store.has_any_parts_for_object(obj), true);
        });

        mocha.it('has_any_parts_for_object deleted', async function() {
            const obj = { _id: parts[2].obj };
            const part_ids = [ parts[2]._id ];
            await md_store.delete_parts_by_ids(part_ids);
            assert.equal(await md_store.has_any_parts_for_object(obj), false);
        });
    });


    mocha.describe('chunks', function() {

        const chunks = [{
            _id: md_store.make_md_id(),
            system: system_id,
            size: 1,
            frag_size: 1,
        }, {
            _id: md_store.make_md_id(),
            system: system_id,
            size: 2,
            frag_size: 2,
            digest: Buffer.from('not a real digest'),
        }];

        mocha.it('insert_chunks()', async function() {
            return md_store.insert_chunks(chunks);
        });

        mocha.it('update_chunk_by_id()', async function() {
            await md_store.update_chunk_by_id(chunks[0]._id, { bucket: bucket_id });
            chunks[0].bucket = bucket_id;
        });

        mocha.it('find_chunks_by_ids()', async function() {
            const res = await md_store.find_chunks_by_ids(_.map(chunks, '_id'));
            if (config.DB_TYPE === 'mongodb') {
                res.forEach(chunk => {
                    if (chunk.digest) chunk.digest = chunk.digest.buffer;
                    if (chunk.cipher_key) chunk.cipher_key = chunk.cipher_key.buffer;
                    if (chunk.cipher_iv) chunk.cipher_iv = chunk.cipher_iv.buffer;
                    if (chunk.cipher_auth_tag) chunk.cipher_auth_tag = chunk.cipher_auth_tag.buffer;
                });
            }
            assert_equal_docs_list(res, chunks);
        });

        mocha.it('delete_chunks_by_ids()', async function() {
            return md_store.delete_chunks_by_ids(_.map(chunks, '_id'));
        });

    });


    mocha.describe('blocks', function() {

        const blocks = [{
            _id: md_store.make_md_id(),
            system: system_id,
            node: md_store.make_md_id(),
            bucket: md_store.make_md_id(),
            chunk: md_store.make_md_id(),
            size: 1,
        }];

        mocha.it('insert_blocks()', async function() {
            return md_store.insert_blocks(blocks);
        });

        mocha.it('delete_blocks_by_ids()', async function() {
            return md_store.delete_blocks_by_ids(blocks.map(block => block._id));
        });


    });

    mocha.describe('dedup-index', function() {
        mocha.it('get_dedup_index_size()', async function() {
            return md_store.get_dedup_index_size();
        });

        mocha.it('get_aprox_dedup_keys_number()', async function() {
            return md_store.get_aprox_dedup_keys_number();
        });

        mocha.it('iterate_indexed_chunks()', async function() {
            return md_store.iterate_indexed_chunks(5);
        });
    });

});


function assert_equal(a, b) {
    if (!_.isEqual(a, b)) {
        assert.fail(a, b, undefined, 'equal');
    }
}

function assert_equal_docs_list(a, b) {
    const a_sorted = _.sortBy(a, x => x._id);
    const b_sorted = _.sortBy(b, x => x._id);
    assert_equal(a_sorted, b_sorted);
}
