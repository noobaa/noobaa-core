/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 600]*/
'use strict';

const util = require('util');
const path = require('path');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');
const fs_utils = require('../../../../util/fs_utils');
const nb_native = require('../../../../util/nb_native');
const size_utils = require('../../../../util/size_utils');
const NamespaceFS = require('../../../../sdk/namespace_fs');
const buffer_utils = require('../../../../util/buffer_utils');
const { get_process_fs_context } = require('../../../../util/native_fs_utils');

const XATTR_VERSION_ID = 'user.noobaa.version_id';
const XATTR_PREV_VERSION_ID = 'user.noobaa.prev_version_id';
//const XATTR_DELETE_MARKER = 'user.noobaa.delete_marker';

const DEFAULT_FS_CONFIG = get_process_fs_context('GPFS');


function make_dummy_object_sdk(nsfs_config, uid, gid) {
    return {
        requesting_account: {
            nsfs_account_config: nsfs_config && {
                uid: uid || process.getuid(),
                gid: gid || process.getgid(),
                backend: 'GPFS',
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

mocha.describe('namespace_fs gpfs- versioning', async function() {
    const gpfs_root_path = process.env.GPFS_ROOT_PATH;
    const gpfs_nsr = 'versioned-gpfs-nsr';
    const gpfs_bucket = 'gpfs_bucket';
    const key = 'key3.txt';
    const gpfs_bucket_path = `${gpfs_root_path}/${gpfs_nsr}/${gpfs_bucket}`;
    const versions_path = path.join(gpfs_bucket_path, '.versions/');
    let second_put_ver_id;
    const dummy_object_sdk = make_dummy_object_sdk(true);
    const ns_obj = new NamespaceFS({ bucket_path: gpfs_bucket_path, bucket_id: '1', namespace_resource_id: undefined, fs_backend: 'GPFS' });

    mocha.before(async function() {
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            console.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
        await fs_utils.create_path(gpfs_bucket_path, 0o770);
        const fs_root_stat = await stat_and_get_all(gpfs_root_path, '');
        if (!fs_root_stat) {
            console.log(`gpfs_root_path - ${gpfs_root_path} doesn't exist. Skipping test`);
            this.skip(); // eslint-disable-line no-invalid-this
        }
        //mocha.after(async () => fs_utils.folder_delete(tmp_fs_root));
    });

    mocha.it('set bucket versioning - Enabled', async function() {
        await ns_obj.set_bucket_versioning('ENABLED', dummy_object_sdk);
        const is_bucket_versioning_en = ns_obj._is_versioning_enabled();
        assert.equal(is_bucket_versioning_en, true);
    });

    mocha.it('put object - versioning disabled - to be enabled', async function() {
        const put_res = await put_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        const head_res = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        // latest version check
        assert.equal(put_res.version_id, head_res.version_id);
        const latest_version_stat = await stat_and_get_all(gpfs_bucket_path, key);

        const latest_version_id = get_version_id_by_xattr(latest_version_stat);
        assert.equal(put_res.version_id, latest_version_id);
    });

    mocha.it('put object - versioning disabled - to be enabled', async function() {
        const second_latest_version = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        const put_res = await put_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        const head_res = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        // latest version check
        assert.equal(put_res.version_id, head_res.version_id);
        second_put_ver_id = put_res.version_id;
        const latest_version_stat = await stat_and_get_all(gpfs_bucket_path, key);
        const latest_version_id = get_version_id_by_xattr(latest_version_stat);
        assert.equal(put_res.version_id, latest_version_id);
        // .versions/ exist
        await fs_utils.file_must_exist(versions_path);
        // find second latest version and compare with the latest before the put
        const second_latest_version_id_by_stat = await find_max_version_past(gpfs_root_path, key, '');
        assert.equal(second_latest_version.VersionId, second_latest_version_id_by_stat);
    });

    mocha.it('put object - versioning disabled - to be enabled', async function() {
        const second_latest_version = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        const put_res = await put_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        const head_res = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        // latest version check
        assert.equal(put_res.version_id, head_res.version_id);
        const latest_version_stat = await stat_and_get_all(gpfs_bucket_path, key);
        const latest_version_id = get_version_id_by_xattr(latest_version_stat);
        assert.equal(put_res.version_id, latest_version_id);
        // .versions/ exist
        await fs_utils.file_must_exist(versions_path);
        // find second latest version and compare with the latest before the put
        const second_latest_version_id_by_stat = await find_max_version_past(gpfs_bucket_path, key, '');
        assert.equal(second_latest_version.version_id, second_latest_version_id_by_stat);
        // TODO:  check that the first version also exist
    });

    mocha.it('delete object version id - versioning disabled', async function() {
        const second_latest_version_id = await find_max_version_past(gpfs_bucket_path, key, '');
        const latest_version = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        const delete_res = await delete_object(dummy_object_sdk, ns_obj, gpfs_bucket, key, latest_version.version_id);
        const head_res = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        // latest version check
        assert.equal(delete_res.version_id, latest_version.version_id);
        assert.equal(head_res.version_id, second_latest_version_id);

        const latest_version_stat = await stat_and_get_all(gpfs_bucket_path, key);
        const latest_version_id = get_version_id_by_xattr(latest_version_stat);
        assert.equal(head_res.version_id, latest_version_id);
        // .versions/ exist
        await fs_utils.file_must_exist(versions_path);
    });

    mocha.it('delete object - create delete marker - versioning disabled - to be enabled', async function() {
        const latest_version = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        const delete_res = await delete_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
        try {
            await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
            assert.fail('head should have failed');
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
        // latest version check
        const delete_marker_version_id = await find_max_version_past(gpfs_bucket_path, key, '');
        assert.equal(delete_res.created_version_id, delete_marker_version_id);
        assert.equal(delete_res.created_delete_marker, true);

        await fs_utils.file_must_not_exist(path.join(gpfs_bucket_path, key));

        // .versions/ exist
        await fs_utils.file_must_exist(versions_path);
        // find second latest version and compare with the latest before the put
        const new_second_latest_version_id_by_stat = await find_max_version_past(gpfs_bucket_path, key, '', [delete_marker_version_id]);
        assert.equal(latest_version.version_id, new_second_latest_version_id_by_stat);
    });

    mocha.it('delete object version id in .versions/ - versioning disabled', async function() {
        try {
            await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
            assert.fail('head should have failed');
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
        const delete_res = await delete_object(dummy_object_sdk, ns_obj, gpfs_bucket, key, second_put_ver_id);
        try {
            await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
            assert.fail('head should have failed');
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
        // version deleted check
        assert.equal(delete_res.version_id, second_put_ver_id);
        const not_exist = await version_file_must_not_exists(gpfs_bucket_path, key, '', second_put_ver_id);
        assert.equal(not_exist, true);
    });

    mocha.it('delete object version id - delete delete marker - versioning disabled', async function() {
        const latest_dm_version_id = await find_max_version_past(gpfs_bucket_path, key, '');
        const second_latest_version_id = await find_max_version_past(gpfs_bucket_path, key, '', [latest_dm_version_id]);

        try {
            await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);
            assert.fail('head should have failed');
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
        const delete_res = await delete_object(dummy_object_sdk, ns_obj, gpfs_bucket, key, latest_dm_version_id);
        const head_res = await head_object(dummy_object_sdk, ns_obj, gpfs_bucket, key);

        // latest version check
        assert.equal(delete_res.version_id, latest_dm_version_id);
        assert.equal(delete_res.deleted_delete_marker, 'true');

        assert.equal(head_res.version_id, second_latest_version_id);

        const latest_version_stat = await stat_and_get_all(gpfs_bucket_path, key);
        const latest_version_id = get_version_id_by_xattr(latest_version_stat);
        assert.equal(head_res.version_id, latest_version_id);
    });

    mocha.it('delete object with version id - versioning enabled', async function() {
        // 1. put bucket versioning enabled
        await ns_obj.set_bucket_versioning('ENABLED', dummy_object_sdk);
        // 2. create multiple versions (2)
        const key2 = 'my-key-to-delete.txt';
        await put_object(dummy_object_sdk, ns_obj, gpfs_bucket, key2);
        const put_res2 = await put_object(dummy_object_sdk, ns_obj, gpfs_bucket, key2);
        // 3. delete object by version-id
        const delete_res = await delete_object(dummy_object_sdk, ns_obj, gpfs_bucket, key2, put_res2.version_id);
        assert.equal(delete_res.version_id, put_res2.version_id);
    });

    mocha.it('delete objects - versioning enabled - use delete_multiple_objects to delete a single non-existing key', async function() {
        // 1. put bucket versioning enabled
        await ns_obj.set_bucket_versioning('ENABLED', dummy_object_sdk);
        // 2. delete objects (a single non existing key)
        const objects = [{ key: 'non-existing-key', version_id: undefined }];
        const delete_objects_res = await delete_multiple_objects(dummy_object_sdk, ns_obj, gpfs_bucket, objects);
        assert.equal(delete_objects_res[0].created_delete_marker, true);
        assert.ok(delete_objects_res[0].created_version_id !== undefined);
    });

    mocha.it('Suspended mode - add object null version twice', async function() {
        await ns_obj.set_bucket_versioning('SUSPENDED', dummy_object_sdk);
        const key3 = 'key3';
        const put_res = await put_object(dummy_object_sdk, ns_obj, gpfs_bucket, key3);
        assert.equal(put_res.version_id, 'null');
        //issue #8379, overwriting null value should not fail on GPFS
        const put_res2 = await put_object(dummy_object_sdk, ns_obj, gpfs_bucket, key3);
        assert.equal(put_res2.version_id, 'null');
    });

});

async function put_object(dummy_object_sdk, ns, bucket, key) {
    const data = crypto.randomBytes(100);
    const source = buffer_utils.buffer_to_read_stream(data);
    const upload_res = await ns.upload_object({
        bucket,
        key,
        source_stream: source
    }, dummy_object_sdk);
    console.log('upload_object response', util.inspect(upload_res));
    return upload_res;
}

async function head_object(dummy_object_sdk, ns, bucket, key) {
    const head_res = await ns.read_object_md({
        bucket,
        key,
    }, dummy_object_sdk);
    console.log('read_object_md response', util.inspect(head_res));
    return head_res;
}

async function delete_object(dummy_object_sdk, ns, bucket, key, version_id) {
    const delete_res = await ns.delete_object({
        bucket,
        key,
        version_id
    }, dummy_object_sdk);
    console.log('delete_object response', util.inspect(delete_res));
    return delete_res;
}

async function delete_multiple_objects(dummy_object_sdk, ns, bucket, objects) {
    const delete_objects_res = await ns.delete_multiple_objects({
        bucket,
        objects
    }, dummy_object_sdk);
    console.log('delete_multiple_objects response', util.inspect(delete_objects_res));
    return delete_objects_res;
}


async function stat_and_get_all(full_path, key) {
    const key_path = path.join(full_path, key);
    try {
        const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
        return stat;
    } catch (err) {
        console.log('stat_and_get_all Error: ', err);
    }
}

// add the prev xattr optimization
async function find_max_version_past(full_path, key, dir, skip_list) {
    const versions_dir = path.join(full_path, dir || '', '.versions');
    try {
        let max_mtime_nsec = 0;
        let max_path;
        const versions = (await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir)).filter(entry => {
            const index = entry.name.endsWith('_null') ? entry.name.lastIndexOf('_null') :
                entry.name.lastIndexOf('_mtime-');
            // don't fail if version entry name is invalid, just keep searching
            return index > 0 && entry.name.slice(0, index) === key;
        });
        for (const entry of versions) {
            if (skip_list ? !skip_list.includes(entry.name.slice(key.length + 1)) : true) {
                const version_str = entry.name.slice(key.length + 1);
                const { mtimeNsBigint } = _extract_version_info_from_xattr(version_str) ||
                    (await nb_native().fs.stat(DEFAULT_FS_CONFIG, path.join(versions_dir, entry.name)));

                if (mtimeNsBigint > max_mtime_nsec) {
                    max_mtime_nsec = mtimeNsBigint;
                    max_path = entry.name;
                }
            }
        }
        return max_path && max_path.slice(key.length + 1);
    } catch (err) {
        console.log('find_max_version_past: .versions is missing', err);
    }
}

function _extract_version_info_from_xattr(version_id_str) {
    if (version_id_str === 'null') return;
    const arr = version_id_str.split('mtime-').join('').split('-ino-');
    if (arr.length < 2) throw new Error('Invalid version_id_string, cannot extact attributes');
    return { mtimeNsBigint: size_utils.string_to_bigint(arr[0], 36), ino: parseInt(arr[1], 36) };
}


// async function version_file_exists(full_path, key, dir, version_id) {
//     const version_path = path.join(full_path, dir, '.versions', key + '_' + version_id);
//     await fs_utils.file_must_exist(version_path);
//     return true;
// }

async function version_file_must_not_exists(full_path, key, dir, version_id) {
    const version_path = path.join(full_path, dir, '.versions', key + '_' + version_id);
    await fs_utils.file_must_not_exist(version_path);
    return true;
}

// async function get_obj_and_compare_data(s3, bucket_name, key, expected_body) {
//     const get_res = await s3.getObject({ Bucket: bucket_name, Key: key }).promise();
//     assert.equal(get_res.Body.toString(), expected_body);
//     return true;
// }

// async function is_delete_marker(full_path, dir, key, version) {
//     const version_path = path.join(full_path, dir, '.versions', key + '_' + version);
//     const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, version_path);
//     return stat && stat.xattr[XATTR_DELETE_MARKER];
// }

// async function stat_and_get_version_id(full_path, key) {
//     const key_path = path.join(full_path, key);
//     const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
//     return get_version_id_by_xattr(stat);
// }

// function get_version_id_by_stat(stat) {
//     return 'mtime-' + stat.mtimeNsBigint.toString(36) + '-ino-' + stat.ino.toString(36);
// }

function get_version_id_by_xattr(stat, prev) {
    if (prev) return stat && stat.xattr[XATTR_PREV_VERSION_ID];
    return (stat && stat.xattr[XATTR_VERSION_ID]) || 'null';
}
