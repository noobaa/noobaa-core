/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');

const P = require('../../util/promise');
const MDStore = require('../../server/object_services/md_store').MDStore;

mocha.describe('md_store', function() {

    const md_store = new MDStore(`_test_md_store_${Date.now().toString(36)}`);
    const system_id = md_store.make_md_id();
    const bucket_id = md_store.make_md_id();

    mocha.describe('objects', function() {

        mocha.it('insert/update/find_object()', function() {
            const info = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket_id,
                key: 'lala_' + Date.now().toString(36),
                create_time: new Date(),
                content_type: 'lulu_' + Date.now().toString(36),
            };
            return P.resolve()
                .then(() => md_store.insert_object(info))
                .then(() => md_store.find_object_by_id(info._id))
                .then(obj => assert_equal(obj, info))
                .then(() => md_store.update_object_by_key(bucket_id, info.key, {
                    upload_size: 666,
                    num_parts: 0
                }))
                .then(() => md_store.update_object_by_id(info._id, { size: 777 }, { upload_size: 1 }, { num_parts: 88 }))
                .then(() => md_store.find_object_by_key(bucket_id, info.key))
                .then(obj => assert_equal(obj, _.defaults({
                    size: 777,
                    num_parts: 88,
                }, info)))
                .then(() => md_store.update_object_by_id(info._id, { deleted: new Date() }))
                .then(() => md_store.find_object_by_key(bucket_id, info.key))
                .then(obj => assert_equal(obj, null))
                .then(() => md_store.update_objects_by_key_deleted(bucket_id, info.key, {
                    num_parts: 111
                }))
                .then(() => md_store.populate_objects({ obj: info._id }, 'obj', {
                    key: 1,
                    num_parts: 1
                }))
                .then(res => {
                    assert_equal(res.obj.key, info.key);
                    assert_equal(res.obj.num_parts, 111);
                })
                .return();
        });

        mocha.it('insert_object() detects missing key (bad schema)', function() {
            const info = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket_id,
            };
            return P.resolve()
                .then(() => md_store.insert_object(info))
                .then(() => {
                    throw new Error('should have failed');
                }, err => {
                    assert(err.message.startsWith('INVALID_SCHEMA_DB'));
                });
        });

        mocha.it('find_objects()', function() {
            return md_store.find_objects({ bucket_id });
        });

        mocha.it('find_objects_by_prefix()', function() {
            return md_store.find_objects_by_prefix_and_delimiter({
                bucket_id,
                prefix: '',
                versioning: {
                    bucket_activated: false,
                    list_versions: false
                }
            });
        });

        mocha.it('find_objects_by_prefix_and_delimiter()', function() {
            return md_store.find_objects_by_prefix_and_delimiter({
                bucket_id,
                prefix: '',
                delimiter: '/',
                versioning: {
                    bucket_activated: false,
                    list_versions: false
                }
            });
        });

        mocha.it('has_any_objects_in_system()', function() {
            return md_store.has_any_objects_in_system(system_id);
        });

        mocha.it('has_any_completed_objects_in_bucket()', function() {
            return md_store.has_any_completed_objects_in_bucket(bucket_id);
        });

        mocha.it('count_objects_of_bucket()', function() {
            return md_store.count_objects_of_bucket(bucket_id);
        });

        mocha.it('count_objects_per_bucket()', function() {
            return md_store.count_objects_per_bucket(system_id);
        });

        mocha.it('aggregate_objects_by_create_dates()', function() {
            const till_time = Date.now();
            const from_time = till_time - (24 * 3600 * 1000);
            return md_store.aggregate_objects_by_create_dates(from_time, till_time);
        });

        mocha.it('aggregate_objects_by_delete_dates()', function() {
            const till_time = Date.now();
            const from_time = till_time - (24 * 3600 * 1000);
            return md_store.aggregate_objects_by_delete_dates(from_time, till_time);
        });

    });


    mocha.describe('cloud-sync', function() {

        mocha.it('list_all_objects_of_bucket_ordered_by_key()', function() {
            return md_store.list_all_objects_of_bucket_ordered_by_key(bucket_id);
        });

        mocha.it('list_all_objects_of_bucket_need_sync()', function() {
            return md_store.list_all_objects_of_bucket_need_sync(bucket_id);
        });

        mocha.it('update_all_objects_of_bucket_unset_cloud_sync()', function() {
            return md_store.update_all_objects_of_bucket_unset_cloud_sync(bucket_id);
        });

        mocha.it('update_all_objects_of_bucket_set_deleted_cloud_sync()', function() {
            return md_store.update_all_objects_of_bucket_set_deleted_cloud_sync(bucket_id);
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

        mocha.it('insert_multipart()', function() {
            return md_store.insert_multipart(multipart);
        });

        mocha.it('delete_multiparts_of_object()', function() {
            const obj = {
                _id: multipart.obj,
            };
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
        }];

        mocha.it('insert_parts()', function() {
            return md_store.insert_parts(parts);
        });

        mocha.it('find_parts_by_start_range()', function() {
            return md_store.find_parts_by_start_range({
                obj_id: parts[0].obj,
                start_gte: 0,
                start_lt: 10,
                end_gt: 5,
            });
        });

        mocha.it('find_parts_chunk_ids()', function() {
            const obj = {
                _id: parts[0].obj,
            };
            return md_store.find_parts_chunk_ids(obj);
        });

        mocha.it('find_parts_by_chunk_ids()', function() {
            const chunk_ids = _.map(parts, 'chunk');
            return md_store.find_parts_by_chunk_ids(chunk_ids);
        });

        mocha.it('find_parts_unreferenced_chunk_ids()', function() {
            const chunk_ids = _.map(parts, 'chunk');
            return md_store.find_parts_unreferenced_chunk_ids(chunk_ids);
        });

        mocha.it('find_parts_chunks_references()', function() {
            const chunk_ids = _.map(parts, 'chunk');
            return md_store.find_parts_chunks_references(chunk_ids);
        });

        mocha.it('load_parts_objects_for_chunks()', function() {
            const chunks = _.map(parts, part => ({
                _id: part.chunk
            }));
            return md_store.load_parts_objects_for_chunks(chunks);
        });

        mocha.it('delete_parts_of_object()', function() {
            const obj = {
                _id: parts[0].obj,
            };
            return md_store.delete_parts_of_object(obj);
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

        mocha.it('insert_chunks()', function() {
            return md_store.insert_chunks(chunks);
        });

        mocha.it('update_chunk_by_id()', function() {
            return md_store.update_chunk_by_id(chunks[0]._id, { bucket: bucket_id })
                .then(() => {
                    chunks[0].bucket = bucket_id;
                });
        });

        mocha.it('find_chunks_by_ids()', function() {
            return md_store.find_chunks_by_ids(_.map(chunks, '_id'))
                .then(res => {
                    res.forEach(chunk => {
                        if (chunk.digest) chunk.digest = chunk.digest.buffer;
                        if (chunk.cipher_key) chunk.cipher_key = chunk.cipher_key.buffer;
                        if (chunk.cipher_iv) chunk.cipher_iv = chunk.cipher_iv.buffer;
                        if (chunk.cipher_auth_tag) chunk.cipher_auth_tag = chunk.cipher_auth_tag.buffer;
                    });
                    assert_equal_docs_list(res, chunks);
                });
        });

        mocha.it('delete_chunks_by_ids()', function() {
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

        mocha.it('insert_blocks()', function() {
            return md_store.insert_blocks(blocks);
        });

        mocha.it('delete_blocks_of_chunks()', function() {
            return md_store.delete_blocks_of_chunks([blocks[0].chunk]);
        });


    });

    mocha.describe('dedup-index', function() {
        mocha.it('get_dedup_index_size()', function() {
            return md_store.get_dedup_index_size();
        });

        mocha.it('get_aprox_dedup_keys_number()', function() {
            return md_store.get_aprox_dedup_keys_number();
        });

        mocha.it('iterate_indexed_chunks()', function() {
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
    const a_sorted = _.sortBy(a, x => x._id.getTimestamp());
    const b_sorted = _.sortBy(b, x => x._id.getTimestamp());
    assert_equal(a_sorted, b_sorted);
}
