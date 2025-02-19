/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const _ = require('lodash');
const P = require('../../../util/promise');
const fs_utils = require('../../../util/fs_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const { TMP_PATH, TEST_TIMEOUT } = require('../../system_tests/test_utils');
const { crypto_random_string } = require('../../../util/string_utils');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');

function make_dummy_object_sdk(nsfs_config, uid, gid) {
    return {
        requesting_account: {
            nsfs_account_config: nsfs_config && {
                uid: uid || process.getuid(),
                gid: gid || process.getgid(),
                backend: '',
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        }
    };
}

const DUMMY_OBJECT_SDK = make_dummy_object_sdk(true);

const tmp_fs_path = path.join(TMP_PATH, 'test_nsfs_concurrency');

const nsfs = new NamespaceFS({
    bucket_path: tmp_fs_path,
    bucket_id: '1',
    namespace_resource_id: undefined,
    access_mode: undefined,
    versioning: 'DISABLED',
    force_md5_etag: false,
    stats: endpoint_stats_collector.instance(),
});

describe('test nsfs concurrency', () => {

    beforeEach(async () => {
        await fs_utils.create_fresh_path(tmp_fs_path);
    });

    afterEach(async () => {
        await fs_utils.folder_delete(tmp_fs_path);
    });

    it('multiple puts of the same nested key', async () => {
        const bucket = 'bucket1';
        const key = 'dir1/key1';
        const res_etags = [];
        for (let i = 0; i < 15; i++) {
            const random_data = Buffer.from(String(crypto_random_string(7)));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
            .catch(err => {
                console.log('put the same key error - ', err);
                throw err;
            }).then(res => {
                console.log('upload res', res);
                res_etags.push(res.etag);
            });
            await nsfs.delete_object({ bucket: bucket, key: key }, DUMMY_OBJECT_SDK).catch(err => console.log('delete the same key error - ', err));

        }
        await P.delay(5000);
        expect(res_etags).toHaveLength(15);
    }, TEST_TIMEOUT);

    it('list objects and delete an object during it', async () => {
        const bucket = 'bucket1';
        const num_of_objects = 5;
        const keys_names = await _upload_objects(bucket, num_of_objects);
        const random_num = random_integer(1, keys_names.length);
        const key_to_delete = `my-key-${random_num}`;

        nsfs.list_objects({ bucket: bucket }, DUMMY_OBJECT_SDK)
            .catch(err => {
                console.log('error during list_objects', err);
                throw err;
            }).then(res => {
                console.log('list was successful');
            });
        nsfs.delete_object({ bucket: bucket, key: key_to_delete }, DUMMY_OBJECT_SDK)
            .catch(err => {
                console.log('delete_object', key_to_delete, 'got an error', err);
                throw err;
            }).then(res => {
                console.log('delete_object during list objects was successful');
            });
        await P.delay(5000);
        // up to this point if it was successful, the race between the delete object and list object went fine.

        // now we will just check that the updated list does not contain the deleted object as expected
        const res_list_objects = await nsfs.list_objects({ bucket: bucket }, DUMMY_OBJECT_SDK);
        const array_of_objects = res_list_objects.objects;
        expect(array_of_objects).toHaveLength(num_of_objects - 1);
        const objects_without_deleted_key = _.every(array_of_objects, object => object.key !== key_to_delete);
        expect(objects_without_deleted_key).toBe(true);
    }, TEST_TIMEOUT);
});

/**
 * _upload_objects uploads number_of_versions of objects in bucket
 * note: this function is not concurrent, it's a helper function for preparing a bucket with a couple of objects
 * @param {string} bucket
 * @param {number} number_of_objects
 */
async function _upload_objects(bucket, number_of_objects) {
    const keys_names = [];
    for (let i = 0; i < number_of_objects; i++) {
        const key_name = `my-key-${i + 1}`;
        const random_data = Buffer.from(String(crypto_random_string(7)));
        const body = buffer_utils.buffer_to_read_stream(random_data);
        await nsfs.upload_object({ bucket: bucket, key: key_name, source_stream: body }, DUMMY_OBJECT_SDK);
        keys_names.push(key_name);
    }
    return keys_names;
}

/**
 * randomInteger between min (included) and max (included)
 * // copied from: https://stackoverflow.com/questions/4959975/generate-random-number-between-two-numbers-in-javascript
 * @param {number} min
 * @param {number} max
 */
function random_integer(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
