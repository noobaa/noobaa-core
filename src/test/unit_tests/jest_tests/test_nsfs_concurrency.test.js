/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const P = require('../../../util/promise');
const fs_utils = require('../../../util/fs_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const { TMP_PATH } = require('../../system_tests/test_utils');
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
describe('test nsfs concurrency', () => {
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
    }, 6000);
});
