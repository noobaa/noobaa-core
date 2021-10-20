/* Copyright (C) 2020 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');

const buffer_utils = require('../../util/buffer_utils');

// eslint-disable-next-line max-lines-per-function
function test_ns_list_objects(ns, object_sdk, bucket) {

    const files_without_folders_to_upload = make_keys(264, i => `file_without_folder${i}`);
    const folders_to_upload = make_keys(264, i => `folder${i}/`);
    const files_in_folders_to_upload = make_keys(264, i => `folder1/file${i}`);
    const files_in_utf_diff_delimiter = make_keys(264, i => `תיקיה#קובץ${i}`);
    const max_keys_objects = make_keys(2604, i => `max_keys_test${i}`);
    const files_in_inner_folders_to_upload_post = make_keys(264, i => `folder1/inner_folder/file${i}`);
    const files_in_inner_folders_to_upload_pre = make_keys(264, i => `folder1/ainner_folder/file${i}`);
    // const files_in_multipart_folders_to_upload = make_keys(264, i => `multipart/file${i}`);
    // const same_multipart_file1 = make_keys(10, i => `multipart1`);
    // const same_multipart_file2 = make_keys(10, i => `multipart3`);
    // const small_folder_with_multipart = make_keys(10, i => `multipart2/file${i}`);
    // const prefix_infinite_loop_test = Object.freeze([`d/d/d/`, `d/d/f`, `d/f`].sort());

    mocha.describe('basic tests', function() {
        this.timeout(10 * 60 * 1000); // eslint-disable-line no-invalid-this

        // prepare by creating objects based on the provided key arrays
        mocha.before(async function() {
            await create_keys([
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
            ]);
        });
        mocha.after(async function() {
            await delete_keys([
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
            ]);
        });

        if (ns.constructor.name !== 'NamespaceFS') {

            // We should get the folder names in common_prefixes
            // And we should get the objects without folders inside objects
            // Also we check that the response is not truncated
            mocha.it('delimiter=#', async function() {
                const r = await ns.list_objects({
                    bucket,
                    delimiter: '#',
                }, object_sdk);
                assert.deepStrictEqual(r.is_truncated, false);
                assert.deepStrictEqual(r.common_prefixes, ['תיקיה#']);
                assert.deepStrictEqual(r.objects.map(it => it.key), [
                    ...folders_to_upload,
                    ...files_in_folders_to_upload,
                    ...files_without_folders_to_upload,
                ].sort());
            });
        }

        // In case we don't fully spell the name of the common prefix
        // We should get all the common prefixes that begin with that prefix
        mocha.it('delimiter=/ prefix=folder', async function() {
            const r = await ns.list_objects({
                bucket,
                delimiter: '/',
                prefix: 'folder'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, folders_to_upload);
            assert.deepStrictEqual(r.objects.map(it => it.key), []);
        });

        // We should get the folder names in common_prefixes
        // And we should get the objects without folders inside objects
        // Also we check that the response is not truncated
        mocha.it('delimiter=/', async function() {
            const r = await ns.list_objects({
                bucket,
                delimiter: '/',
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, folders_to_upload);
            assert.deepStrictEqual(r.objects.map(it => it.key), [
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
            ]);
        });

        // We should get nothing in common_prefixes
        // And we should get the objects inside folder1 in objects
        // Also we check that the response is not truncated
        mocha.it('delimiter=/ prefix=folder1/', async function() {
            const r = await ns.list_objects({
                bucket,
                delimiter: '/',
                prefix: 'folder1/'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            assert.deepStrictEqual(r.objects.map(it => it.key), [
                'folder1/',
                ...files_in_folders_to_upload
            ]);
        });

        // Should be like the first check, but because of limit 5 we should only
        // Receive the first 5 files without folders under root and not all the folders
        // Which means that the common_prefixes should be zero, and only 5 objects
        // This tests the sorting algorithm of the response, and also the max-keys limit
        mocha.it('delimiter=/ limit=5', async function() {
            const r = await ns.list_objects({
                bucket,
                delimiter: '/',
                limit: 5
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, true);
            assert.deepStrictEqual(r.common_prefixes, []);
            assert.deepStrictEqual(r.objects.map(it => it.key), [
                'file_without_folder0',
                'file_without_folder1',
                'file_without_folder10',
                'file_without_folder100',
                'file_without_folder101',
            ].sort());
        });

        // Should be like the first check, but because of limit 5 we should only
        // Receive the first 5 files without folders under root and not all the folders
        // Which means that the common_prefixes should be zero, and only 5 objects
        // This tests the sorting algorithm of the response, and also the max-keys limit
        mocha.it('prefix=file_without', async function() {
            const r = await ns.list_objects({
                bucket,
                prefix: 'file_without',
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            assert.deepStrictEqual(r.objects.map(it => it.key), files_without_folders_to_upload);
        });

        // Checking that we return object that complies fully to the prefix and don't skip it
        // This test was added after Issue #2600
        mocha.it('prefix=file_without_folder0', async function() {
            const r = await ns.list_objects({
                bucket,
                prefix: 'file_without_folder0',
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            assert.deepStrictEqual(r.objects.map(it => it.key), files_without_folders_to_upload.slice(0, 1));
        });

        mocha.it('limit=0', async function() {
            const r = await ns.list_objects({
                bucket,
                limit: 0
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            assert.deepStrictEqual(r.objects.map(it => it.key), []);
        });

        // Should be like the first check, but because of limit 1
        // We loop and ask to list several times to get all of the objects/common_prefixes
        // This checks the correctness of max-keys/next-marker/sort
        mocha.it('delimiter=/ limit=1 truncated_listing', async function() {
            const r = await truncated_listing({
                bucket,
                delimiter: '/',
                limit: 1,
            });
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, folders_to_upload);
            assert.deepStrictEqual(r.objects.map(it => it.key), [
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
            ].sort());

        });

    });

    mocha.describe('list objects - dirs', function() {

        this.timeout(10 * 60 * 1000); // eslint-disable-line no-invalid-this

        mocha.before(async function() {
            await create_keys([
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
                ...files_in_inner_folders_to_upload_pre,
                ...files_in_inner_folders_to_upload_post
            ]);
        });
        mocha.after(async function() {
            await delete_keys([
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
                ...files_in_inner_folders_to_upload_pre,
                ...files_in_inner_folders_to_upload_post
            ]);
        });
        mocha.it('key_marker=folder229/', async function() {
            const r = await ns.list_objects({
                bucket,
                key_marker: 'folder229/'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            const fd = folders_to_upload.filter(folder => folder > 'folder229/');
            assert.deepStrictEqual(r.objects.map(it => it.key), [...fd, ...files_in_utf_diff_delimiter]);
        });

        mocha.it('key_marker=folder1/', async function() {
            const r = await ns.list_objects({
                bucket,
                key_marker: 'folder1/'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, true);
            assert.deepStrictEqual(r.common_prefixes, []);
            const fd = folders_to_upload.filter(folder => folder > 'folder1/');
            const fd1 = files_in_folders_to_upload;
            assert.deepStrictEqual(r.objects.map(it => it.key), [...files_in_inner_folders_to_upload_pre,
                ...fd1, ...files_in_inner_folders_to_upload_post,
                ...fd, ...files_in_utf_diff_delimiter
            ].slice(0, 1000));
        });

        mocha.it('key_marker=folder1/file57', async function() {
            const r = await ns.list_objects({
                bucket,
                key_marker: 'folder1/file57'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            const fd = folders_to_upload.filter(folder => folder > 'folder1/');
            const fd1 = files_in_folders_to_upload.filter(folder => folder > 'folder1/file57');
            assert.deepStrictEqual(r.objects.map(it => it.key), [...fd1, ...files_in_inner_folders_to_upload_post,
                ...fd, ...files_in_utf_diff_delimiter
            ]);
        });

        mocha.it('key_marker=folder1/inner_folder/file40', async function() {
            const r = await ns.list_objects({
                bucket,
                key_marker: 'folder1/inner_folder/file40'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            const fd1 = files_in_inner_folders_to_upload_post.filter(file => file > 'folder1/inner_folder/file40');
            const fd = folders_to_upload.filter(folder => folder > 'folder1/');
            assert.deepStrictEqual(r.objects.map(it => it.key), [...fd1, ...fd, ...files_in_utf_diff_delimiter]);
        });

        mocha.it('key_marker=folder1/inner_folder/', async function() {
            const r = await ns.list_objects({
                bucket,
                key_marker: 'folder1/inner_folder/'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            const fd1 = files_in_inner_folders_to_upload_post.filter(file => file > 'folder1/inner_folder/');
            const fd = folders_to_upload.filter(folder => folder > 'folder1/inner_folder/');
            assert.deepStrictEqual(r.objects.map(it => it.key), [...fd1, ...fd, ...files_in_utf_diff_delimiter]);
        });

        mocha.it('key_marker=folder1/ainner_folder/', async function() {
            const r = await ns.list_objects({
                bucket,
                key_marker: 'folder1/ainner_folder/file50'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, true);
            assert.deepStrictEqual(r.common_prefixes, []);
            const fd = folders_to_upload.filter(folder => folder > 'folder1/ainner_folder/');
            const fd2 = files_in_inner_folders_to_upload_pre.filter(file => file > 'folder1/ainner_folder/file50');
            assert.deepStrictEqual(r.objects.map(it => it.key), [...fd2, ...files_in_folders_to_upload,
                ...files_in_inner_folders_to_upload_post,
                ...fd, ...files_in_utf_diff_delimiter
            ].slice(0, 1000));
        });

        mocha.it('key_marker=folder1/inner_folder/file40 delimiter=/', async function() {
            const r = await ns.list_objects({
                bucket,
                key_marker: 'folder1/inner_folder/file40',
                delimiter: '/'
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, false);
            const fd = folders_to_upload.filter(folder => folder > 'folder1/');
            assert.deepStrictEqual(r.common_prefixes, fd);
            assert.deepStrictEqual(r.objects.map(it => it.key), files_in_utf_diff_delimiter);
        });
    });

    mocha.describe('max keys test', function() {

        this.timeout(10 * 60 * 1000); // eslint-disable-line no-invalid-this

        mocha.before(async function() {
            await create_keys(max_keys_objects);
        });
        mocha.after(async function() {
            await delete_keys(max_keys_objects);
        });

        mocha.it('limits to 1000 even when asked more', async function() {
            const r = await ns.list_objects({
                bucket,
                limit: 2604
            }, object_sdk);
            assert.deepStrictEqual(r.is_truncated, true);
            assert.deepStrictEqual(r.common_prefixes, []);
            assert.deepStrictEqual(r.objects.map(it => it.key), max_keys_objects.slice(0, 1000));
        });

        // Note that in case of S3Controller we return an appropriate error value to the client
        mocha.it('error on negative limit', async function() {
            try {
                await ns.list_objects({
                    bucket,
                    limit: -2604
                }, object_sdk);
                assert.fail('Error expected');
            } catch (err) {
                assert.strict.equal(err.message, 'Limit must be a positive Integer');
            }
        });

        // Should be like the first check, but because of limit 1
        // We loop and ask to list several times to get all of the objects/common_prefixes
        // This checks the correctness of max-keys/next-marker/sort
        mocha.it('truncated_listing', async function() {
            const r = await truncated_listing({
                bucket,
                delimiter: '/',
                limit: 7,
            });
            assert.deepStrictEqual(r.is_truncated, false);
            assert.deepStrictEqual(r.common_prefixes, []);
            assert.deepStrictEqual(r.objects.map(it => it.key), max_keys_objects);
        });

    });

    /**
     * @param {number} count 
     * @param {(i:number)=>string} gen 
     * @returns {string[]}
     */
    function make_keys(count, gen) {
        const arr = new Array(count);
        for (let i = 0; i < count; ++i) arr[i] = gen(i);
        arr.sort();
        Object.freeze(arr);
        return arr;
    }

    async function create_keys(keys) {
        return Promise.all(keys.map(async key => {
            await ns.upload_object({
                bucket,
                key,
                content_type: 'application/octet-stream',
                source_stream: buffer_utils.buffer_to_read_stream(null)
            }, object_sdk);
        }));
    }

    async function delete_keys(keys) {
        await ns.delete_multiple_objects({
            bucket,
            objects: keys.map(key => ({ key })),
        }, object_sdk);
    }

    async function truncated_listing(params, use_upload_id_marker, upload_mode) {

        // Initialization of IsTruncated in order to perform the first while cycle
        var res = {
            is_truncated: true,
            objects: [],
            common_prefixes: [],
        };

        params.key_marker = '';
        if (use_upload_id_marker) {
            params.upload_id_marker = '';
        }

        while (res.is_truncated) {
            const r = await (
                upload_mode ?
                ns.list_uploads(params, object_sdk) :
                ns.list_objects(params, object_sdk)
            );
            // console.log(r);
            res.objects.push(...r.objects);
            res.common_prefixes.push(...r.common_prefixes);
            res.is_truncated = r.is_truncated;
            if (params.delimiter) {
                params.key_marker = r.next_marker;
                if (use_upload_id_marker) params.upload_id_marker = r.upload_id_marker;
            } else {
                const last = r.objects[r.objects.length - 1];
                params.key_marker = last.key;
                if (use_upload_id_marker) params.upload_id_marker = last.upload_id;
            }
        }

        return res;
    }
}

module.exports = test_ns_list_objects;
