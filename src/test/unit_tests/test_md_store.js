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
                .then(() => md_store.find_object_by_key_allow_missing(bucket_id, info.key))
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

        mocha.it('insert_object() bad schema', function() {
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
                    assert(err.message.startsWith('BAD COLLECTION SCHEMA'));
                });
        });

        mocha.it('find_objects()', function() {
            return md_store.find_objects({ bucket_id });
        });

        mocha.it('find_objects_by_prefix()', function() {
            return md_store.find_objects_by_prefix_and_delimiter({
                bucket_id,
                prefix: '',
            });
        });

        mocha.it('find_objects_by_prefix_and_delimiter()', function() {
            return md_store.find_objects_by_prefix_and_delimiter({
                bucket_id,
                prefix: '',
                delimiter: '/',
            });
        });

        mocha.it('has_any_objects_in_system()', function() {
            return md_store.has_any_objects_in_system(system_id);
        });

        mocha.it('has_any_objects_in_bucket()', function() {
            return md_store.has_any_objects_in_bucket(bucket_id);
        });

        mocha.it('count_objects_of_bucket()', function() {
            return md_store.count_objects_of_bucket(bucket_id);
        });

        mocha.it('count_objects_per_bucket()', function() {
            return md_store.count_objects_per_bucket(system_id);
        });

        mocha.it('aggregate_objects_by_create_dates()', function() {
            const till_date = new Date();
            const from_date = new Date(till_date.getTime() - (24 * 3600 * 1000));
            return md_store.aggregate_objects_by_create_dates(from_date, till_date);
        });

        mocha.it('aggregate_objects_by_delete_dates()', function() {
            const till_date = new Date();
            const from_date = new Date(till_date.getTime() - (24 * 3600 * 1000));
            return md_store.aggregate_objects_by_delete_dates(from_date, till_date);
        });

    });


    mocha.describe('cloud-sync', function() {

        mocha.it('list_all_objects_of_bucket_ordered_by_key()', function() {
            return md_store.list_all_objects_of_bucket_ordered_by_key(bucket_id);
        });

        mocha.it('list_all_objects_of_bucket_need_sync()', function() {
            return md_store.list_all_objects_of_bucket_need_sync(bucket_id);
        });

        mocha.it('update_all_objects_of_bucket_set_cloud_sync()', function() {
            return md_store.update_all_objects_of_bucket_set_cloud_sync(bucket_id);
        });

        mocha.it('update_all_objects_of_bucket_unset_deleted_cloud_sync()', function() {
            return md_store.update_all_objects_of_bucket_unset_deleted_cloud_sync(bucket_id);
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
            return md_store.delete_multiparts_of_object(obj, new Date());
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

        mocha.it('load_parts_objects_for_chunks()', function() {
            const chunks = _.map(parts, part => ({
                _id: part.chunk
            }));
            return md_store.load_parts_objects_for_chunks(chunks);
        });

        mocha.it('copy_object_parts()', function() {
            const obj = {
                system: parts[0].system,
                _id: parts[0].obj,
            };
            const target_obj = {
                system: parts[0].system,
                _id: md_store.make_md_id(),
            };
            return md_store.copy_object_parts(obj, target_obj);
        });

        mocha.it('delete_parts_of_object()', function() {
            const obj = {
                _id: parts[0].obj,
            };
            return md_store.delete_parts_of_object(obj, new Date());
        });

    });


    mocha.describe('chunks', function() {

        const chunks = [{
            _id: md_store.make_md_id(),
            system: system_id,
            size: 1,
            digest_type: '',
            digest_b64: '',
            cipher_type: '',
            cipher_key_b64: '',
            data_frags: 1,
            lrc_frags: 0,
        }, {
            _id: md_store.make_md_id(),
            system: system_id,
            size: 2,
            digest_type: '',
            digest_b64: '',
            cipher_type: '',
            cipher_key_b64: '',
            data_frags: 1,
            lrc_frags: 0,
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

        mocha.it('update_chunks_by_ids()', function() {
            return md_store.update_chunks_by_ids(_.map(chunks, '_id'), { special_replica: true })
                .then(() => {
                    for (const chunk of chunks) {
                        chunk.special_replica = true;
                    }
                });

        });

        mocha.it('find_chunks_by_ids()', function() {
            return md_store.find_chunks_by_ids(_.map(chunks, '_id'))
                .then(res => assert_equal_docs_list(res, chunks));
        });

        mocha.it('delete_chunks_by_ids()', function() {
            return md_store.delete_chunks_by_ids(_.map(chunks, '_id'), new Date());
        });

    });


    mocha.describe('blocks', function() {

        const blocks = [{
            _id: md_store.make_md_id(),
            system: system_id,
            node: md_store.make_md_id(),
            bucket: md_store.make_md_id(),
            chunk: md_store.make_md_id(),
            layer: 'D',
            frag: 0,
            size: 1,
            digest_type: '',
            digest_b64: '',
        }];

        mocha.it('insert_blocks()', function() {
            return md_store.insert_blocks(blocks);
        });

        mocha.it('delete_blocks_of_chunks()', function() {
            return md_store.delete_blocks_of_chunks([blocks[0].chunk], new Date());
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
