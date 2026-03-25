/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ["error", 2000]*/
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../config');

// const P = require('../../util/promise');
const MDStore = require('../../../server/object_services/md_store').MDStore;

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

        const now = new Date();
        const info1 = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: 'lala_1' + now.getTime().toString(36),
            create_time: now,
            content_type: 'lulu_' + now.getTime().toString(36),
        };
        const info2 = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: 'lala_2' + now.getTime().toString(36),
            create_time: now,
            content_type: 'lulu_' + now.getTime().toString(36),
        };
        const max_create_time = now.getTime() / 1000 - 60; // 1 minute ago

        mocha.it('delete_objects_by_query - key', async function() {
            if (config.DB_TYPE !== 'postgres') this.skip(); // eslint-disable-line no-invalid-this
            info1._id = md_store.make_md_id();
            await md_store.insert_object(info1);
            info2._id = md_store.make_md_id();
            await md_store.insert_object(info2);
            let obj = await md_store.find_object_by_id(info1._id);
            assert_equal(obj, info1);
            obj = await md_store.find_object_by_id(info2._id);
            assert_equal(obj, info2);
            const objects = await md_store.delete_objects_by_query({
                bucket_id: bucket_id,
                key: /^lala_/,
                return_results: true,
            });
            console.log('deleted objects:', objects);
            assert_equal(objects.length, 2);
        });

        mocha.it('delete_objects_by_query - max_create_time', async function() {
            if (config.DB_TYPE !== 'postgres') this.skip(); // eslint-disable-line no-invalid-this
            info1._id = md_store.make_md_id();
            info1.create_time = new Date(max_create_time - 100);
            await md_store.insert_object(info1);
            info2._id = md_store.make_md_id();
            await md_store.insert_object(info2);
            let obj = await md_store.find_object_by_id(info1._id);
            assert_equal(obj, info1);
            obj = await md_store.find_object_by_id(info2._id);
            assert_equal(obj, info2);
            const query = {
                key: /^lala_/,
                bucket_id: bucket_id,
                max_create_time,
                return_results: true,
            };
            let objects = await md_store.delete_objects_by_query(query);
            console.log('deleted objects:', objects);
            assert_equal(objects.length, 1);
            query.max_create_time = now.getTime() / 1000 + 1; // 1 second later
            objects = await md_store.delete_objects_by_query(query);
            console.log('deleted objects:', objects);
            assert_equal(objects.length, 1);
        });

        mocha.it('delete_objects_by_query - limit', async function() {
            if (config.DB_TYPE !== 'postgres') this.skip(); // eslint-disable-line no-invalid-this
            info1._id = md_store.make_md_id();
            await md_store.insert_object(info1);
            info2._id = md_store.make_md_id();
            await md_store.insert_object(info2);
            let obj = await md_store.find_object_by_id(info1._id);
            assert_equal(obj, info1);
            obj = await md_store.find_object_by_id(info2._id);
            assert_equal(obj, info2);
            const objects = await md_store.delete_objects_by_query({
                key: /^lala_/,
                bucket_id: bucket_id,
                limit: 1,
                return_results: true,
            });
            console.log('deleted objects:', objects);
            assert_equal(objects.length, 1);
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

         mocha.it('find_deleted_objects returns deleted and reclaimed objects', async function() {
            if (config.DB_TYPE !== 'postgres') this.skip(); // eslint-disable-line no-invalid-this
            for (let i = 0; i < 50; i++) { // create 50 objects
                info1._id = md_store.make_md_id();
                info1.key = `lala_${i}_${now.getTime().toString(36)}`;
                await md_store.insert_object(info1);
            }
            // mark all 50 objects as deleted
            const deleted_objects = await md_store.delete_objects_by_query({
                key: /^lala_/,
                bucket_id: bucket_id,
                limit: 50,
                return_results: true,
            });
            // mark all 50 deleted objects as reclaimed
            await md_store.update_objects_by_ids(deleted_objects.map(obj => obj._id), { reclaimed: new Date() });
            // find 25 objects that are deleted and reclaimed
            const objects = await md_store.find_deleted_objects(now.getTime() + 60 * 1000, 25);
            assert_equal(objects.length, 25);
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
            }
        ];

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
            const part_ids = [parts[1]._id];
            return md_store.delete_parts_by_ids(part_ids);
        });

        mocha.it('has_any_parts_for_object exists', async function() {
            const obj = { _id: parts[2].obj };
            assert.equal(await md_store.has_any_parts_for_object(obj), true);
        });

        mocha.it('has_any_parts_for_object deleted', async function() {
            const obj = { _id: parts[2].obj };
            const part_ids = [parts[2]._id];
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
            assert_equal_docs_list(res, chunks);
        });

        mocha.it('delete_chunks_by_ids()', async function() {
            return md_store.delete_chunks_by_ids(_.map(chunks, '_id'));
        });

        mocha.it('find_chunks_by_dedup_key()', async () => {
            if (config.DB_TYPE !== 'postgres') return; // feature uses SQL path
            const bucket = { _id: md_store.make_md_id(), system: { _id: system_id } };
            const chunk = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket._id,
                frags: [{ _id: md_store.make_md_id() }],
                size: 10,
                frag_size: 10,
                dedup_key: Buffer.from('noobaa')
            };
            const block = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket._id,
                node: md_store.make_md_id(),
                chunk: chunk._id,
                frag: chunk.frags[0]._id,
                size: 10,
            };
            await md_store.insert_chunks([chunk]);
            await md_store.insert_blocks([block]);
            const chunksArr = await md_store.find_chunks_by_dedup_key(bucket, [Buffer.from('noobaa').toString('base64')]);
            assert(Array.isArray(chunksArr));
            assert(chunksArr.length >= 1);
            assert(chunksArr[0].frags[0]?._id?.toString() === chunk.frags[0]._id.toString());
            assert(chunksArr[0].frags[0].blocks.length >= 1);
        });

        mocha.it('test find_chunks_by_dedup_key - dedup_key doesnt exist in DB', async () => {
            if (config.DB_TYPE !== 'postgres') return; // feature uses SQL path
            const bucket = { _id: md_store.make_md_id(), system: { _id: system_id } };
            const chunksArr = await md_store.find_chunks_by_dedup_key(bucket, [Buffer.from('unknownkey').toString('base64')]);
            assert(Array.isArray(chunksArr));
            assert(chunksArr.length === 0);
        });

        mocha.it('find_chunks_by_dedup_key empty dedup_key array passed', async () => {
            if (config.DB_TYPE !== 'postgres') return; // feature uses SQL path
            const bucket = { _id: md_store.make_md_id(), system: { _id: system_id } };

            const chunksArr = await md_store.find_chunks_by_dedup_key(bucket, []);
            assert(Array.isArray(chunksArr));
            assert(chunksArr.length === 0);
        });

        mocha.it('find_chunks_by_dedup_key - multiple chunks with multiple frags and blocks', async () => {
            if (config.DB_TYPE !== 'postgres') return;
            const bucket = { _id: md_store.make_md_id(), system: { _id: system_id } };
            const frag1a = { _id: md_store.make_md_id() };
            const frag1b = { _id: md_store.make_md_id() };
            const frag2a = { _id: md_store.make_md_id() };
            const chunk1 = {
                _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                frags: [frag1a, frag1b], size: 10, frag_size: 5,
                dedup_key: Buffer.from('multi_test_key1'),
            };
            const chunk2 = {
                _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                frags: [frag2a], size: 20, frag_size: 20,
                dedup_key: Buffer.from('multi_test_key2'),
            };
            const blocks = [
                { _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                    node: md_store.make_md_id(), chunk: chunk1._id, frag: frag1a._id, size: 5 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                    node: md_store.make_md_id(), chunk: chunk1._id, frag: frag1a._id, size: 5 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                    node: md_store.make_md_id(), chunk: chunk1._id, frag: frag1b._id, size: 5 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                    node: md_store.make_md_id(), chunk: chunk2._id, frag: frag2a._id, size: 20 },
            ];
            await md_store.insert_chunks([chunk1, chunk2]);
            await md_store.insert_blocks(blocks);

            const dedup_keys = [
                Buffer.from('multi_test_key1').toString('base64'),
                Buffer.from('multi_test_key2').toString('base64'),
            ];
            const result = await md_store.find_chunks_by_dedup_key(bucket, dedup_keys);

            assert(result.length === 2);
            const res_chunk1 = result.find(c => c._id.toString() === chunk1._id.toString());
            const res_chunk2 = result.find(c => c._id.toString() === chunk2._id.toString());
            assert(res_chunk1);
            assert(res_chunk2);
            assert(res_chunk1.frags[0].blocks.length === 2);
            assert(res_chunk1.frags[1].blocks.length === 1);
            assert(res_chunk2.frags[0].blocks.length === 1);
        });

        mocha.it('find_chunks_by_dedup_key - excludes deleted chunks', async () => {
            if (config.DB_TYPE !== 'postgres') return;
            const bucket = { _id: md_store.make_md_id(), system: { _id: system_id } };
            const chunk = {
                _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                frags: [{ _id: md_store.make_md_id() }], size: 10, frag_size: 10,
                dedup_key: Buffer.from('deleted_chunk_key'),
            };
            const block = {
                _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                node: md_store.make_md_id(), chunk: chunk._id, frag: chunk.frags[0]._id, size: 10,
            };
            await md_store.insert_chunks([chunk]);
            await md_store.insert_blocks([block]);
            await md_store.delete_chunks_by_ids([chunk._id]);

            const dk = Buffer.from('deleted_chunk_key').toString('base64');
            const result = await md_store.find_chunks_by_dedup_key(bucket, [dk]);
            assert(result.length === 0);
        });

        mocha.it('find_chunks_by_dedup_key - excludes deleted blocks', async () => {
            if (config.DB_TYPE !== 'postgres') return;
            const bucket = { _id: md_store.make_md_id(), system: { _id: system_id } };
            const chunk = {
                _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                frags: [{ _id: md_store.make_md_id() }], size: 10, frag_size: 10,
                dedup_key: Buffer.from('deleted_block_key'),
            };
            const block = {
                _id: md_store.make_md_id(), system: system_id, bucket: bucket._id,
                node: md_store.make_md_id(), chunk: chunk._id, frag: chunk.frags[0]._id, size: 10,
            };
            await md_store.insert_chunks([chunk]);
            await md_store.insert_blocks([block]);
            await md_store.delete_blocks_by_ids([block._id]);

            const dk = Buffer.from('deleted_block_key').toString('base64');
            const result = await md_store.find_chunks_by_dedup_key(bucket, [dk]);
            // chunk has no non-deleted blocks, so INNER JOIN excludes it
            assert(result.length === 0);
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

    mocha.describe('load_blocks_for_chunks', function() {

        mocha.it('loads blocks and groups them into chunk.frags[].blocks', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const bid = md_store.make_md_id();
            const frag1 = { _id: md_store.make_md_id() };
            const frag2 = { _id: md_store.make_md_id() };
            const chunk = {
                _id: md_store.make_md_id(), system: system_id, bucket: bid,
                frags: [frag1, frag2], size: 10, frag_size: 5,
            };
            const blocks = [
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk._id, frag: frag1._id, size: 5 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk._id, frag: frag1._id, size: 5 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk._id, frag: frag2._id, size: 5 },
            ];
            await md_store.insert_chunks([chunk]);
            await md_store.insert_blocks(blocks);

            await md_store.load_blocks_for_chunks([chunk]);

            assert(chunk.frags[0].blocks.length === 2);
            assert(chunk.frags[1].blocks.length === 1);
            assert(chunk.frags[1].blocks[0]._id.toString() === blocks[2]._id.toString());
        });

        mocha.it('handles multiple chunks at once', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const bid = md_store.make_md_id();
            const chunk1 = {
                _id: md_store.make_md_id(), system: system_id, bucket: bid,
                frags: [{ _id: md_store.make_md_id() }], size: 10, frag_size: 10,
            };
            const chunk2 = {
                _id: md_store.make_md_id(), system: system_id, bucket: bid,
                frags: [{ _id: md_store.make_md_id() }], size: 20, frag_size: 20,
            };
            const blocks = [
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk1._id, frag: chunk1.frags[0]._id, size: 10 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk2._id, frag: chunk2.frags[0]._id, size: 20 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk2._id, frag: chunk2.frags[0]._id, size: 20 },
            ];
            await md_store.insert_chunks([chunk1, chunk2]);
            await md_store.insert_blocks(blocks);

            await md_store.load_blocks_for_chunks([chunk1, chunk2]);

            assert(chunk1.frags[0].blocks.length === 1);
            assert(chunk2.frags[0].blocks.length === 2);
        });

        mocha.it('sets empty blocks array for chunks with no blocks', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const chunk = {
                _id: md_store.make_md_id(), system: system_id, bucket: md_store.make_md_id(),
                frags: [{ _id: md_store.make_md_id() }], size: 10, frag_size: 10,
            };
            await md_store.insert_chunks([chunk]);

            await md_store.load_blocks_for_chunks([chunk]);

            assert(Array.isArray(chunk.frags[0].blocks));
            assert(chunk.frags[0].blocks.length === 0);
        });

        mocha.it('excludes deleted blocks', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const bid = md_store.make_md_id();
            const chunk = {
                _id: md_store.make_md_id(), system: system_id, bucket: bid,
                frags: [{ _id: md_store.make_md_id() }], size: 10, frag_size: 10,
            };
            const live_block = {
                _id: md_store.make_md_id(), system: system_id, bucket: bid,
                node: md_store.make_md_id(), chunk: chunk._id, frag: chunk.frags[0]._id, size: 10,
            };
            const deleted_block = {
                _id: md_store.make_md_id(), system: system_id, bucket: bid,
                node: md_store.make_md_id(), chunk: chunk._id, frag: chunk.frags[0]._id, size: 10,
            };
            await md_store.insert_chunks([chunk]);
            await md_store.insert_blocks([live_block, deleted_block]);
            await md_store.delete_blocks_by_ids([deleted_block._id]);

            await md_store.load_blocks_for_chunks([chunk]);

            assert(chunk.frags[0].blocks.length === 1);
            assert(chunk.frags[0].blocks[0]._id.toString() === live_block._id.toString());
        });

        mocha.it('applies sorter when provided', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const bid = md_store.make_md_id();
            const chunk = {
                _id: md_store.make_md_id(), system: system_id, bucket: bid,
                frags: [{ _id: md_store.make_md_id() }], size: 10, frag_size: 10,
            };
            const blocks = [
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk._id, frag: chunk.frags[0]._id, size: 300 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk._id, frag: chunk.frags[0]._id, size: 100 },
                { _id: md_store.make_md_id(), system: system_id, bucket: bid,
                    node: md_store.make_md_id(), chunk: chunk._id, frag: chunk.frags[0]._id, size: 200 },
            ];
            await md_store.insert_chunks([chunk]);
            await md_store.insert_blocks(blocks);

            const sorter = (a, b) => a.size - b.size;
            await md_store.load_blocks_for_chunks([chunk], sorter);

            const sizes = chunk.frags[0].blocks.map(b => b.size);
            assert.deepStrictEqual(sizes, [100, 200, 300]);
        });

        mocha.it('returns early on empty input', async function() {
            await md_store.load_blocks_for_chunks([]);
            await md_store.load_blocks_for_chunks(null);
            await md_store.load_blocks_for_chunks(undefined);
        });
    });

    mocha.describe('parts and blocks mapping queries', function() {

        const frag_id = md_store.make_md_id();
        const map_bucket_id = md_store.make_md_id();
        const map_obj = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: map_bucket_id,
            key: 'map-test-key-' + Date.now().toString(36),
            create_time: new Date(),
            content_type: 'application/octet-stream',
        };
        const map_chunk = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: map_bucket_id,
            size: 100,
            frag_size: 100,
            frags: [{ _id: frag_id }],
        };
        const map_part = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: map_bucket_id,
            obj: map_obj._id,
            chunk: map_chunk._id,
            start: 0,
            end: 100,
            seq: 0,
        };
        const map_block = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: map_bucket_id,
            node: md_store.make_md_id(),
            chunk: map_chunk._id,
            frag: frag_id,
            size: 100,
        };

        mocha.before(async function() {
            if (config.DB_TYPE !== 'postgres') this.skip(); // eslint-disable-line no-invalid-this
            await md_store.insert_object(map_obj);
            await md_store.insert_chunks([map_chunk]);
            await md_store.insert_parts([map_part]);
            await md_store.insert_blocks([map_block]);
        });

        mocha.it('find_object_with_mapping_by_key - basic case', async function() {
            const result = await md_store.find_object_with_mapping_by_key(
                String(map_bucket_id), map_obj.key, 10
            );
            assert(result !== null, 'expected non-null result');
            assert.strictEqual(String(result.obj._id), String(map_obj._id));
            assert.strictEqual(result.parts.length, 1);
            assert.strictEqual(result.chunks_db.length, 1);
            assert.strictEqual(String(result.parts[0].chunk), String(map_chunk._id));
            const frag = result.chunks_db[0].frags[0];
            assert(frag.blocks.length >= 1, 'expected block to be populated in frag');
            assert.strictEqual(String(frag.blocks[0].chunk), String(map_chunk._id));
        });

        mocha.it('find_object_with_mapping_by_key - key not found returns null', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const result = await md_store.find_object_with_mapping_by_key(
                String(map_bucket_id), 'nonexistent-key-' + Date.now(), 10
            );
            assert.strictEqual(result, null);
        });

        mocha.it('find_object_with_mapping_by_key - deleted object excluded', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const del_obj = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: map_bucket_id,
                key: 'deleted-map-key-' + Date.now().toString(36),
                create_time: new Date(),
                content_type: 'application/octet-stream',
            };
            await md_store.insert_object(del_obj);
            await md_store.update_object_by_id(del_obj._id, { deleted: new Date() });
            const result = await md_store.find_object_with_mapping_by_key(
                String(map_bucket_id), del_obj.key, 10
            );
            assert.strictEqual(result, null);
        });

        mocha.it('find_object_with_mapping_by_key - zero-part object returns obj with empty parts', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const zero_part_obj = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: map_bucket_id,
                key: 'zero-part-' + Date.now().toString(36),
                create_time: new Date(),
                content_type: 'application/octet-stream',
            };
            await md_store.insert_object(zero_part_obj);
            const result = await md_store.find_object_with_mapping_by_key(
                String(map_bucket_id), zero_part_obj.key, 10
            );
            assert(result !== null, 'expected non-null result for existing zero-part object');
            assert.strictEqual(String(result.obj._id), String(zero_part_obj._id));
            assert.strictEqual(result.parts.length, 0, 'expected empty parts array');
            assert.strictEqual(result.chunks_db.length, 0, 'expected empty chunks_db array');
        });

        mocha.it('find_object_with_mapping_by_key - respects max_parts limit', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const limited_obj = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: map_bucket_id,
                key: 'limited-parts-' + Date.now().toString(36),
                create_time: new Date(),
                content_type: 'application/octet-stream',
            };
            await md_store.insert_object(limited_obj);
            const limited_chunks = [0, 1, 2].map(() => ({
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: map_bucket_id,
                size: 10,
                frag_size: 10,
                frags: [{ _id: md_store.make_md_id() }],
            }));
            await md_store.insert_chunks(limited_chunks);
            const limited_parts = limited_chunks.map((c, i) => ({
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: map_bucket_id,
                obj: limited_obj._id,
                chunk: c._id,
                start: i * 10,
                end: (i + 1) * 10,
                seq: i,
            }));
            await md_store.insert_parts(limited_parts);
            const result = await md_store.find_object_with_mapping_by_key(
                String(map_bucket_id), limited_obj.key, 1
            );
            assert(result !== null, 'expected non-null result');
            assert.strictEqual(result.parts.length, 1, 'expected only 1 part due to max_parts limit');
            assert.strictEqual(Number(result.parts[0].start), 0, 'expected first (lowest-start) part');
        });

        mocha.it('find_parts_chunks_blocks_by_range - returns parts and blocks in range', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const result = await md_store.find_parts_chunks_blocks_by_range({
                obj_id: map_part.obj,
                start_gte: 0,
                start_lt: 100,
                end_gt: 0,
            });
            assert.strictEqual(result.parts.length, 1);
            assert.strictEqual(result.chunks_db.length, 1);
            assert.strictEqual(String(result.parts[0].chunk), String(map_chunk._id));
            assert(result.chunks_db[0].frags[0].blocks.length >= 1, 'expected blocks populated in frag');
        });

        mocha.it('find_parts_chunks_blocks_by_range - parts outside range excluded', async function() {
            if (config.DB_TYPE !== 'postgres') return;
            const result = await md_store.find_parts_chunks_blocks_by_range({
                obj_id: map_part.obj,
                start_gte: 200,
                start_lt: 300,
                end_gt: 200,
            });
            assert.strictEqual(result.parts.length, 0);
            assert.strictEqual(result.chunks_db.length, 0);
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
