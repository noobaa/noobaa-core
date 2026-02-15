/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 900]*/
/* eslint-disable max-params */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const util = require('util');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');
const P = require('../../../util/promise');
const config = require('../../../../config');
const fs_utils = require('../../../util/fs_utils');
const time_utils = require('../../../util/time_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const s3_utils = require('../../../endpoint/s3/s3_utils');
const buffer_utils = require('../../../util/buffer_utils');
const { TMP_PATH } = require('../../system_tests/test_utils');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

const XATTR_MD5_KEY = 'content_md5';
const DUMMY_OBJECT_SDK = make_DUMMY_OBJECT_SDK();

const src_bkt = 'src';
const tmp_fs_path = path.join(TMP_PATH, 'test_namespace_fs_mpu');
const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;

function make_DUMMY_OBJECT_SDK() {
    return {
        requesting_account: {
            force_md5_etag: false,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
        read_bucket_full_info(name) {
            return {};
        }
    };
}


mocha.describe('namespace_fs mpu optimization tests', function() {

    const upload_bkt = 'test_ns_uploads_object';
    const mpu_bkt = 'test_ns_multipart_upload';

    const ns_tmp = new NamespaceFS({
        bucket_path: ns_tmp_bucket_path,
        bucket_id: '2',
        namespace_resource_id: undefined,
        access_mode: undefined,
        versioning: undefined,
        force_md5_etag: false,
        stats: endpoint_stats_collector.instance(),
    });

    mocha.before(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.create_fresh_path(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.folder_delete(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.it('MPU | MIX | 10000 different size', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_upload_10000_mix_size';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 10000;
        const src_file_path = 'mpu_upload_10000_mix_size.txt';
        const parts_properties = { mixed_sizes: {} };
        for (let i = 1; i <= num_parts; i++) {
            parts_properties.mixed_sizes[i] = { size: i, pass_size: true };
        }
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | MIX | mid is different size', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_upload_mid_unique';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_upload_mid_unique.txt';
        const parts_properties = {
            mixed_sizes: {
                1: { size: 10, pass_size: true },
                2: { size: 5, pass_size: true },
                3: { size: 10, pass_size: true }
            }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | MIX ', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_upload';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_mix.txt';
        const parts_properties = {
            mixed_sizes: {
                1: { size: 10, pass_size: true },
                2: { size: 5, pass_size: true },
                3: { size: 1, pass_size: true }
            }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | MIX | no part size parameter in upload part ', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_mix_no_size_param';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_mix_no_size_param.txt';
        const parts_properties = {
            mixed_sizes: {
                1: { size: 10, pass_size: false },
                2: { size: 5, pass_size: false },
                3: { size: 1, pass_size: false }
            }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | MIX | same size at the end ', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_mix_same_size_end';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 4;
        const src_file_path = 'mpu_mix_same_size_end.txt';
        const parts_properties = {
            mixed_sizes: {
                1: { size: 10, pass_size: false },
                2: { size: 5, pass_size: false },
                3: { size: 5, pass_size: false },
                4: { size: 5, pass_size: false }
            }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | TAIL', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        ns_tmp.force_md5_etag = true;
        const mpu_key = 'mpu_tail';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_tail.txt';
        const part_size = 10;
        const tail_part_size = 3;
        const parts_properties = {
            common_size: { size: part_size, pass_size: true},
            tail: { size: tail_part_size, pass_size: true }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | TAIL | no part size parameter in upload part ', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_tail_no_size_param';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 2;
        const part_size = 10;
        const tail_part_size = 5;
        const src_file_path = 'mpu_tail_no_size_param.txt';
        const parts_properties = {
            common_size: { size: part_size, pass_size: false },
            tail: { size: tail_part_size, pass_size: false }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    /*
    // the 8GB test throws error of no space left on device when running on CI
    mocha.it('MPU | TAIL | 8GB ', async function() {
        this.timeout(200000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_tail_no_size_param1';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 1000;
        const part_size = 8000000;
        const tail_part_size = 50;
        const src_file_path = 'mpu_tail_no_size_param1.txt';
        const parts_properties = {
            common_size: { size: part_size, pass_size: false },
            tail: { size: tail_part_size, pass_size: false }
        };
        // skip assert read true because size is too big
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path, true);
    });*/

    mocha.it('MPU | COMMON SIZE | single part ', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_single_part1';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 1;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_single_part1.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE | single part | no part size parameter in upload part', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_single_part2';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 1;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_single_part2.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: false } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE | no part size parameter in upload part', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_no_size_param';
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_no_size_param.txt';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const parts_properties = { common_size: { size: part_size, pass_size: false } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | TAIL -> COMMON SIZE | override TAIL to COMMON SIZE', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        ns_tmp.force_md5_etag = true;
        const mpu_key = 'mpu_tail_override_to_common_size';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_tail_override_to_common_size.txt';
        const part_size = 10;
        const tail_part_size = 3;
        const parts_properties = {
            common_size: { size: part_size, pass_size: true},
            tail: { size: tail_part_size, pass_size: true, override: part_size}
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | TAIL -> TAIL | override TAIL to NEW UNIQUE SIZE', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        ns_tmp.force_md5_etag = true;
        const mpu_key = 'mpu_tail_override_to_unique_size';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_tail_override_to_unique_size.txt';
        const part_size = 10;
        const tail_part_size = 3;
        const tail_override_part_size = 5;
        const parts_properties = {
            common_size: { size: part_size, pass_size: true},
            tail: { size: tail_part_size, pass_size: true, override: tail_override_part_size}
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | TAIL -> TAIL | override TAIL to tail size, different data', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this
        ns_tmp.force_md5_etag = true;
        const mpu_key = 'mpu_tail_override_to_tail_size';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_tail_override_to_tail_size.txt';
        const part_size = 10;
        const tail_part_size = 3;
        const parts_properties = {
            common_size: { size: part_size, pass_size: true},
            tail: { size: tail_part_size, pass_size: true, override: tail_part_size}
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE -> TAIL | override last part of common size to be different size (TAIL)', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_to_tail';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_to_tail.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true, override: { part_num: 3, new_size: 15 } } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE -> COMMON SIZE | override last part of common size to be common size, different data', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_to_common_size1';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_to_common_size1.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true, override: { part_num: 3, new_size: 10 } } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE -> COMMON SIZE | override last part of common size to be common size, different data', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_to_common_size2';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_to_common_size2.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true, override: { part_num: 1, new_size: 10 } } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE -> COMMON SIZE | override mid part of common size to be common size, different data', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_to_common_size3';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_to_common_size3.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true, override: { part_num: 2, new_size: 10 } } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE -> MIX | override first part to be different size', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_to_mix1';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_to_mix1.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true, override: { part_num: 1, new_size: 15 } } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | COMMON SIZE -> MIX | override mid part to be different size', async function() {
        this.timeout(2000000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_to_mix2';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 10;
        const src_file_path = 'mpu_common_size_to_mix2.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true, override: { part_num: 2, new_size: 15 } } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    // LARGE FILES 
    mocha.it('MPU | COMMON SIZE - large files', async function() {
        this.timeout(200000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_common_size_large';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const part_size = 17000000;
        const src_file_path = 'mpu_common_size_large.txt';
        const parts_properties = { common_size: { size: part_size, pass_size: true } };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | TAIL - large file', async function() {
        this.timeout(200000); // eslint-disable-line no-invalid-this
        ns_tmp.force_md5_etag = true;
        const mpu_key = 'mpu_tail_large';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 2;
        const src_file_path = 'mpu_tail_large';
        const part_size = 8900000;
        const tail_part_size = 5;
        const parts_properties = {
            common_size: { size: part_size, pass_size: true},
            tail: { size: tail_part_size, pass_size: true }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });

    mocha.it('MPU | MIX | mid is different size - large size', async function() {
        this.timeout(200000); // eslint-disable-line no-invalid-this
        const mpu_key = 'mpu_upload_mid_unique_large';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        const num_parts = 3;
        const src_file_path = 'mpu_upload_mid_unique_large.txt';
        const parts_properties = {
            mixed_sizes: {
                1: { size: 9000000, pass_size: true },
                2: { size: 5000000, pass_size: true },
                3: { size: 9000000, pass_size: true }
            }
        };
        await mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_properties, src_file_path);
    });
});


// parts_sizes_obj - { tail: { size: number, pass_size } , common_size: { size: number, pass_size: bool }, mixed_sizes: { num number: { size: number, pass_size: bool } }}
async function mpu_test_flow(ns_tmp, mpu_bkt, mpu_key, xattr, num_parts, parts_sizes_obj, src_file_path, skip_assert_read) {

    const create_mpu_res = await create_mpu(ns_tmp, mpu_bkt, mpu_key, xattr);
    const upload_id = create_mpu_res.obj_id;
    const result_file_path = `${ns_tmp_bucket_path}/${mpu_key}`;
    const multiparts = await upload_parts(ns_tmp, num_parts, src_file_path, mpu_bkt, mpu_key, upload_id, parts_sizes_obj);

    if (parts_sizes_obj.tail) {
        const tail_part_num = num_parts + 1;
        const to_be_override_size = parts_sizes_obj.tail.override;
        const { size, pass_size } = parts_sizes_obj.tail;
        let tail_multipart_res = await upload_single_part(ns_tmp, tail_part_num, src_file_path, mpu_bkt,
            mpu_key, upload_id, size, pass_size, to_be_override_size);
        if (to_be_override_size) {
            tail_multipart_res = await upload_single_part(ns_tmp, tail_part_num, src_file_path, mpu_bkt,
                mpu_key, upload_id, to_be_override_size, pass_size);
        }
        multiparts.push({ etag: tail_multipart_res.etag, num: tail_part_num });
    }
    const complete_res = await complete_mpu(ns_tmp, mpu_bkt, mpu_key, upload_id, multiparts);

    if (config.NSFS_CALCULATE_MD5 ||
        ns_tmp.force_md5_etag || DUMMY_OBJECT_SDK.requesting_account.force_md5_etag) xattr[XATTR_MD5_KEY] = complete_res.etag;


    const md5_original_data = await calc_md5(src_file_path);
    const md5_final_data = await calc_md5(result_file_path);
    assert.strictEqual(md5_final_data, md5_original_data);

    if (!skip_assert_read) {
        const read_data = await read_object(ns_tmp, mpu_bkt, mpu_key);
        const md5_read_res = await calc_md5_stream(read_data);
        assert.strictEqual(md5_final_data, md5_read_res);
    }

    const md = await ns_tmp.read_object_md({
        bucket: mpu_bkt,
        key: mpu_key,
    }, DUMMY_OBJECT_SDK);
    assert.deepStrictEqual(xattr, md.xattr);

    await ns_tmp.delete_object({
        bucket: mpu_bkt,
        key: mpu_key,
    }, DUMMY_OBJECT_SDK);

    fs.rm(src_file_path, _.noop);
}

async function create_mpu(namespace_fs_obj, mpu_bkt, mpu_key, xattr) {
    const create_res = await namespace_fs_obj.create_object_upload({
        bucket: mpu_bkt,
        key: mpu_key,
        xattr,
    }, DUMMY_OBJECT_SDK);
    return create_res;
}

async function upload_single_part(namespace_fs_obj, part_num, original_file, mpu_bkt, mpu_key, upload_id, size, pass_size, to_be_override) {

    const data_part = crypto.randomBytes(size);
    if (!to_be_override) {
        fs.writeFileSync(original_file, data_part, { flag: 'a+' });
    }
    const part_res = await namespace_fs_obj.upload_multipart({
        obj_id: upload_id,
        bucket: mpu_bkt,
        key: mpu_key,
        num: part_num,
        source_stream: buffer_utils.buffer_to_read_stream(data_part),
        size: pass_size ? size : undefined
    }, DUMMY_OBJECT_SDK);
    console.log('upload_multipart response', inspect(part_res));
    return part_res;
}


async function upload_parts(namespace_fs_obj, parts_num, original_file, mpu_bkt, mpu_key, upload_id, parts_props_obj) {
    const multiparts = [];
    for (let i = 0; i < parts_num; ++i) {
        const part_num = i + 1;
        const { size = undefined, pass_size = false, override = undefined } = parts_props_obj.common_size ||
                    (parts_props_obj.mixed_sizes && parts_props_obj.mixed_sizes[part_num]);
        if (!size) throw new Error('Invalid part properties');
        const override_part = override && override.part_num === part_num;
        let part_res = await upload_single_part(namespace_fs_obj, part_num, original_file, mpu_bkt, mpu_key,
            upload_id, size, pass_size, override_part);
        if (override_part) {
            const { new_size } = parts_props_obj.common_size.override;
            part_res = await upload_single_part(namespace_fs_obj, part_num, original_file, mpu_bkt, mpu_key, upload_id, new_size, true);
        }
        multiparts.push({ num: part_num, etag: part_res.etag });
    }

    return multiparts;
}


async function complete_mpu(namespace_fs_obj, mpu_bkt, mpu_key, upload_id, multiparts) {
    const start = time_utils.millistamp();
    const complete_res = await namespace_fs_obj.complete_object_upload({
        obj_id: upload_id,
        bucket: mpu_bkt,
        key: mpu_key,
        multiparts,
    }, DUMMY_OBJECT_SDK);
    const took = time_utils.millistamp() - start;
    console.log(`test_namespace_fs_mpu: complete_mpu - ${upload_id} took ${took} ms`);
    return complete_res;
}

async function read_object(namespace_fs_obj, mpu_bkt, mpu_key) {
    const read_res = buffer_utils.write_stream();
    await namespace_fs_obj.read_object_stream({
        bucket: mpu_bkt,
        key: mpu_key,
    }, DUMMY_OBJECT_SDK, read_res);
    const read_data = read_res.join();
    return read_data;
}

async function calc_md5_stream(write_data) {
    const hash = crypto.createHash('md5');
    hash.update(write_data);
    return hash.digest('hex');
}

async function calc_md5(path_to_read) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        fs.createReadStream(path_to_read)
            .on('error', reject)
            .pipe(hash)
            .on('error', reject)
            .on('finish', () => resolve(hash.digest('hex')));
    });
}
