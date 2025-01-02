/* Copyright (C) 2020 NooBaa */
/*eslint max-statements: ["error", 80, { "ignoreTopLevelFunctions": true }]*/
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const LRUCache = require('../util/lru_cache');
const native_fs_utils = require('./native_fs_utils');
const nb_native = require('./nb_native');
const dbg = require('../util/debug_module')(__filename);
const error_utils = require('../util/error_utils');
const s3_utils = require('../endpoint/s3/s3_utils');
const size_utils = require('../util/size_utils');

const NULL_VERSION_ID = 'null';
const NULL_VERSION_SUFFIX = '_' + NULL_VERSION_ID;
const HIDDEN_VERSIONS_PATH = '.versions';
const XATTR_USER_PREFIX = 'user.';
const XATTR_NOOBAA_INTERNAL_PREFIX = XATTR_USER_PREFIX + 'noobaa.';
const XATTR_DIR_CONTENT = XATTR_NOOBAA_INTERNAL_PREFIX + 'dir_content';
const XATTR_STORAGE_CLASS_KEY = XATTR_USER_PREFIX + 'storage_class';
const XATTR_TAG = XATTR_NOOBAA_INTERNAL_PREFIX + 'tag.';
const XATTR_MD5_KEY = XATTR_USER_PREFIX + 'content_md5';
const XATTR_METADATA_IGNORE_LIST = [
    XATTR_STORAGE_CLASS_KEY,
];

/**
 * @typedef {{
*  time: number,
*  stat: nb.NativeFSStats,
*  usage: number,
*  sorted_entries?: fs.Dirent[],
* }} ReaddirCacheItem
* @type {LRUCache<object, string, ReaddirCacheItem>}
*/
const dir_cache = new LRUCache({
   name: 'nsfs-dir-cache',
   make_key: ({ dir_path }) => dir_path,
   load: async ({ dir_path, fs_context }) => {
       const time = Date.now();
       const stat = await nb_native().fs.stat(fs_context, dir_path);
       let sorted_entries;
       let usage = config.NSFS_DIR_CACHE_MIN_DIR_SIZE;
       if (stat.size <= config.NSFS_DIR_CACHE_MAX_DIR_SIZE) {
           sorted_entries = await nb_native().fs.readdir(fs_context, dir_path);
           sorted_entries.sort(sort_entries_by_name);
           for (const ent of sorted_entries) {
               usage += ent.name.length + 4;
           }
       }
       return { time, stat, sorted_entries, usage };
   },
   validate: async ({ stat }, { dir_path, fs_context }) => {
       const new_stat = await nb_native().fs.stat(fs_context, dir_path);
       return (new_stat.ino === stat.ino && new_stat.mtimeNsBigint === stat.mtimeNsBigint);
   },
   item_usage: ({ usage }, dir_path) => usage,
   max_usage: config.NSFS_DIR_CACHE_MAX_TOTAL_SIZE,
});

/**
* @typedef {{
*  time: number,
*  stat: nb.NativeFSStats,
*  ver_dir_stat: nb.NativeFSStats,
*  usage: number,
*  sorted_entries?: fs.Dirent[],
* }} ReaddirVersionsCacheItem
* @type {LRUCache<object, string, ReaddirVersionsCacheItem>}
*/
const versions_dir_cache = new LRUCache({
   name: 'nsfs-versions-dir-cache',
   make_key: ({ dir_path }) => dir_path,
   load: async ({ dir_path, fs_context }) => {
       const time = Date.now();
       const stat = await nb_native().fs.stat(fs_context, dir_path);
       const version_path = dir_path + "/" + HIDDEN_VERSIONS_PATH;
       let ver_dir_stat_size;
       let is_version_path_exists = false;
       let ver_dir_stat;
       try {
           ver_dir_stat = await nb_native().fs.stat(fs_context, version_path);
           ver_dir_stat_size = ver_dir_stat.size;
           is_version_path_exists = true;
       } catch (err) {
           if (err.code === 'ENOENT') {
               dbg.log0('NamespaceFS: Version dir not found, ', version_path);
           } else {
               throw err;
           }
           ver_dir_stat = null;
           ver_dir_stat_size = 0;
       }
       let sorted_entries;
       let usage = config.NSFS_DIR_CACHE_MIN_DIR_SIZE;
       if (stat.size + ver_dir_stat_size <= config.NSFS_DIR_CACHE_MAX_DIR_SIZE) {
           const latest_versions = await nb_native().fs.readdir(fs_context, dir_path);
           if (is_version_path_exists) {
               const old_versions = await nb_native().fs.readdir(fs_context, version_path);
               // In case we have a null version id inside .versions/ directory we will rename it
               // Therefore, old_versions_after_rename will not include an entry with 'null' suffix
               // (in case stat fails on a version we would remove it from the array)
               const {
                   renamed_null_versions_set,
                   old_versions_after_rename
               } = await _rename_null_version(old_versions, fs_context, version_path);
               const entries = latest_versions.concat(old_versions_after_rename);
               sorted_entries = entries.sort(sort_entries_by_name_and_time);
               // rename back version to include 'null' suffix.
               if (renamed_null_versions_set.size > 0) {
                   for (const ent of sorted_entries) {
                       if (renamed_null_versions_set.has(ent.name)) {
                           const file_name = _get_filename(ent.name);
                           const version_name_with_null = file_name + NULL_VERSION_SUFFIX;
                           ent.name = version_name_with_null;
                       }
                   }
               }
           } else {
               sorted_entries = latest_versions.sort(sort_entries_by_name);
           }
           /*eslint no-unused-expressions: ["error", { "allowTernary": true }]*/
           for (const ent of sorted_entries) {
               usage += ent.name.length + 4;
           }
       }
       return { time, stat, ver_dir_stat, sorted_entries, usage };
   },
   validate: async ({ stat, ver_dir_stat }, { dir_path, fs_context }) => {
       const new_stat = await nb_native().fs.stat(fs_context, dir_path);
       const versions_dir_path = path.normalize(path.join(dir_path, '/', HIDDEN_VERSIONS_PATH));
       let new_versions_stat;
       try {
           new_versions_stat = await nb_native().fs.stat(fs_context, versions_dir_path);
       } catch (err) {
           if (err.code === 'ENOENT') {
               dbg.log0('NamespaceFS: Version dir not found, ', versions_dir_path);
           } else {
               throw err;
           }
       }
       return (new_stat.ino === stat.ino &&
           new_stat.mtimeNsBigint === stat.mtimeNsBigint &&
           new_versions_stat?.ino === ver_dir_stat?.ino &&
           new_versions_stat?.mtimeNsBigint === ver_dir_stat?.mtimeNsBigint);
   },
   item_usage: ({ usage }, dir_path) => usage,
   max_usage: config.NSFS_DIR_CACHE_MAX_TOTAL_SIZE,
});

/**
     * Process list objects entries
     * @param {Object} bucket
     * @param {fs.Dirent} ent
     * @param {string} marker_curr
     * @param {string} dir_path
     * @param {string} dir_key
     * @param {import('../sdk/list_object_fs')} list_obj
     * @param {string} pos
     */
async function process_entry({bucket_path, bucket_id }, ent, marker_curr, dir_path, dir_key, list_obj, pos = '') {

    if ((!ent.name.startsWith(list_obj.prefix_ent) ||
        (pos === '' && ent.name < marker_curr.split('/')[0]) ||
        ent.name === get_bucket_tmpdir_name(bucket_id) ||
        ent.name === config.NSFS_FOLDER_OBJECT_NAME) ||
        _is_hidden_version_path(ent.name)) {
        return;
    }
    const isDir = await is_directory_or_symlink_to_directory(ent, list_obj.fs_context, path.join(dir_path, ent.name));
    let r;
    if (list_obj.list_versions && _is_version_or_null_in_file_name(ent.name)) {
        r = {
            key: _get_version_entry_key(dir_key, ent),
            common_prefix: isDir,
            is_latest: false,
            marker_pos: pos,
            pre_dir: dir_key ? dir_key : '/',
        };
    } else {
        r = {
            key: _get_entry_key(dir_key, ent, isDir),
            common_prefix: isDir,
            is_latest: true,
            marker_pos: pos,
            pre_dir: dir_key ? dir_key : '/',
        };
    }
    if (config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED && list_obj.list_type === '2') {
        await insert_unsort_entry_to_results_arr(bucket_path, bucket_id, r, list_obj);
    } else {
        await insert_entry_to_results_arr(bucket_path, bucket_id, r, list_obj);
    }
}

/**
 *  Process sorted list objects entries
 * @param {string} bucket_path
 * @param {string} bucket_id
 * @param {Object} r
 * @param {import('../sdk/list_object_fs')} list_obj
 */
async function insert_entry_to_results_arr(bucket_path, bucket_id, r, list_obj) {
    let pos;
    // Since versions are arranged next to latest object in the latest first order,
    // no need to find the sorted last index. Push the ".versions/#VERSION_OBJECT" as
    // they are in order
    if (list_obj.results.length && r.key < list_obj.results[list_obj.results.length - 1].key &&
        !_is_hidden_version_path(r.key)) {
        pos = _.sortedLastIndexBy(list_obj.results, r, a => a.key);
    } else {
        pos = list_obj.results.length;
    }
    if (pos >= list_obj.limit) {
        list_obj.is_truncated = true;
        return; // not added
    }
    if (!list_obj.delimiter && r.common_prefix) {
        await process_dir(bucket_path, bucket_id, r.key, list_obj);
    } else {
        if (list_obj.keymarker.key_marker_value === r.key) {
            return;
        }
        if (pos < list_obj.results.length) {
                list_obj.results.splice(pos, 0, r);
        } else {
                list_obj.results.push(r);
        }
        if (list_obj.results.length > list_obj.limit) {
            list_obj.results.length = list_obj.limit;
            list_obj.is_truncated = true;
        }
    }
}

/**
 * Process unsorted list objects entries
 * @param {string} bucket_path
 * @param {string} bucket_id
 * @param {Object} r
 * @param {import('../sdk/list_object_fs')} list_obj
 */
async function insert_unsort_entry_to_results_arr(bucket_path, bucket_id, r, list_obj) {
    // Since versions are arranged next to latest object in the latest first order,
    // no need to find the sorted last index. Push the ".versions/#VERSION_OBJECT" as
    // they are in order
    const pos = list_obj.results.length;
    if (pos >= list_obj.limit) {
        if (list_obj.keymarker.last_pre_dir) {
            await list_obj.keymarker.add_previour_dir(list_obj.keymarker.last_pre_dir, list_obj.keymarker.last_pre_dir_position);
        }
        list_obj.is_truncated = true;
        return; // not added
    }
    if (!list_obj.delimiter && r.common_prefix) {
        if (r.marker_pos && !list_obj.keymarker.pre_dir.includes(r.pre_dir)) {
            await list_obj.keymarker.add_previour_dir(r.pre_dir, r.marker_pos);
        }
        await process_dir(bucket_path, bucket_id, r.key, list_obj);
    } else {
        if (list_obj.keymarker.key_marker_value === r.key) {
            return;
        }
        list_obj.results.push(r);
        if (list_obj.results.length > list_obj.limit) {
            list_obj.results.length = list_obj.limit;
            list_obj.is_truncated = true;
        }
        await list_obj.keymarker.update_last_previour_dir('', '');
    }
}

/**
 * Process unsorted list objects dir path
 * @param {string} bucket_path
 * @param {string} dir_key
 * @param {string} marker_curr
 * @param {string} dir_path
 * @param {import('../sdk/list_object_fs')} list_obj
 */
async function process_unsort_entry(bucket_path, bucket_id, dir_key, marker_curr, dir_path, list_obj, dir_handle) {
    for (;;) {
        if (list_obj.is_truncated) break;
        const dir_entry = await dir_handle.read(list_obj.fs_context);
        // After listing the last item from sub dir, check for parent dirs and parent directory position 
        // and go back to that position.
        if (!dir_entry) {
            // Skip item listing in bucket root path when list flow coming from sub dir to bucket root dir,
            // if do not skip items in bucket root path will list two times, 
            // first in normal flow, and second when return back from sub dir.
            if (bucket_path + '/' === dir_path) {
                list_obj.skip_list = true;
            }
            // After iterating the last element in subdir flow will go back to the parent folder, 
            // to avoid listing items again from start use previous dir path and position from 
            // previous_dirs and previous_dir_positions arrays respectively.
            if (list_obj.keymarker.pre_dir.length > 0) {
                list_obj.keymarker.last_pre_dir = list_obj.keymarker.pre_dir.pop();
                list_obj.keymarker.last_pre_dir_position = list_obj.keymarker.pre_dir_pos.pop();
                // Next dir process will use the previous dir path and position to iterate from 
                // the previously left parentt dir position.
                await list_obj.keymarker.update_key_marker(list_obj.keymarker.last_pre_dir, list_obj.keymarker.last_pre_dir_position);
                await process_dir(bucket_path, bucket_id, list_obj.keymarker.last_pre_dir, list_obj);
            }
            break;
        }
        if ((dir_entry.name === config.NSFS_FOLDER_OBJECT_NAME && dir_key === list_obj.marker_dir) || list_obj.skip_list) {
            continue;
        }
        await process_entry({bucket_path, bucket_id}, dir_entry, marker_curr, dir_path, dir_key, list_obj, (list_obj.param_key_marker && !list_obj.keymarker.is_unsorted) ? '' : dir_entry.off);
    }
}

/**
     * Process objects dir path
     * @param {string} bucket_path
     * @param {string} bucket_id
     * @param {string} dir_key
     * @param {import('../sdk/list_object_fs')} list_obj
     * @returns {Promise<void>}
     */
async function process_dir(bucket_path, bucket_id, dir_key, list_obj) {
    if (_is_hidden_version_path(dir_key)) {
        return;
    }
    // /** @type {fs.Dir} */
    let dir_handle;
    /** @type {ReaddirCacheItem} */
    let cached_dir;
    const dir_path = path.join(bucket_path, dir_key);
    const prefix_dir = list_obj.prefix.slice(0, dir_key.length);
    const prefix_ent = list_obj.prefix.slice(dir_key.length);
    if (!dir_key.startsWith(prefix_dir)) {
        // dbg.log0(`prefix dir does not match so no keys in this dir can apply: dir_key=${dir_key} prefix_dir=${prefix_dir}`);
        return;
    }

    const marker_dir = list_obj.keymarker.key_marker_value.slice(0, dir_key.length);
    const marker_ent = list_obj.keymarker.key_marker_value.slice(dir_key.length);
    // marker is after dir so no keys in this dir can apply
    if (dir_key < marker_dir) {
        // dbg.log0(`marker is after dir so no keys in this dir can apply: dir_key=${dir_key} marker_dir=${marker_dir}`);
        return;
    }
    // when the dir portion of the marker is completely below the current dir
    // then every key in this dir satisfies the marker and marker_ent should not be used.

    const marker_curr = (marker_dir < dir_key) ? '' : marker_ent;
    // dbg.log0(`process_dir: dir_key=${dir_key} prefix_ent=${prefix_ent} marker_curr=${marker_curr}`);

    await list_obj.update_process_dir_properties(prefix_ent, marker_curr, dir_path);
    const push_dir_entries = async (marker_index, sorted_entries) => {
        if (marker_index) {
            const prev_dir = sorted_entries[marker_index - 1];
            const prev_dir_name = prev_dir.name;
            if (marker_curr.startsWith(prev_dir_name) && dir_key !== prev_dir.name) {
                if (!list_obj.delimiter) {
                    const isDir = await is_directory_or_symlink_to_directory(
                        prev_dir, list_obj.fs_context, path.join(dir_path, prev_dir_name, '/'));
                    if (isDir) {
                        const prev_dir_key = path.join(dir_key, prev_dir_name, '/');
                        await process_dir(bucket_path, bucket_id, prev_dir_key, list_obj);
                    }
                }
            }
        }
    };

    if (!(await check_access(list_obj.fs_context, dir_path, bucket_path))) return;
    try {
        if (list_obj.list_versions) {
            cached_dir = await versions_dir_cache.get_with_cache({ dir_path, fs_context: list_obj.fs_context });
        } else {
            cached_dir = await dir_cache.get_with_cache({ dir_path, fs_context: list_obj.fs_context });
        }
    } catch (err) {
        if (['ENOENT', 'ENOTDIR'].includes(err.code)) {
            dbg.log0('NamespaceFS: no keys for non existing dir', dir_path);
            return;
        }
        throw err;
    }

    // insert dir object to objects list if its key is lexicographicly bigger than the key marker &&
    // no delimiter OR prefix is the current directory entry
    const is_dir_content = cached_dir.stat.xattr && cached_dir.stat.xattr[XATTR_DIR_CONTENT];
    if (is_dir_content && dir_key > list_obj.keymarker.key_marker_value && (!list_obj.delimiter || dir_key === list_obj.prefix)) {
        const r = { key: dir_key, common_prefix: false };
        if (config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED && list_obj.list_type === '2') {
            await insert_unsort_entry_to_results_arr(bucket_path, bucket_id, r, list_obj);
        } else {
            await insert_entry_to_results_arr(bucket_path, bucket_id, r, list_obj);
        }
    }

    if (!config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED && cached_dir.sorted_entries) {
        const sorted_entries = cached_dir.sorted_entries;
        let marker_index;
        // Two ways followed here to find the index.
        // 1. When inside marker_dir: Here the entries are sorted based on time. Here
        //    FindIndex() is called since sortedLastIndexBy() expects sorted order by name
        // 2. When marker_dir above dir_path: sortedLastIndexBy() is called since entries are
        //     sorted by name
        // 3. One of the below conditions, marker_curr.includes('/') checks whether
        //    the call is for the directory that contains marker_curr
        if (list_obj.list_versions && marker_curr && !marker_curr.includes('/')) {
            let start_marker = marker_curr;
            if (list_obj.version_id_marker) start_marker = list_obj.version_id_marker;
            marker_index = _.findIndex(
                sorted_entries,
                {name: start_marker}
            ) + 1;
        } else {
            marker_index = _.sortedLastIndexBy(
                sorted_entries,
                make_named_dirent(marker_curr),
                get_entry_name
            );
        }

        // handling a scenario in which key_marker points to an object inside a directory
        // since there can be entries inside the directory that will need to be pushed
        // to results array
        await push_dir_entries(marker_index, sorted_entries);
        for (let i = marker_index; i < sorted_entries.length; ++i) {
            const ent = sorted_entries[i];
            // when entry is NSFS_FOLDER_OBJECT_NAME=.folder file,
            // and the dir key marker is the name of the curr directory - skip on adding it
            if (ent.name === config.NSFS_FOLDER_OBJECT_NAME && dir_key === marker_dir) {
                continue;
            }
            await process_entry({bucket_path, bucket_id}, ent, marker_curr, dir_path, dir_key, list_obj);
            // since we traverse entries in sorted order,
            // we can break as soon as enough keys are collected.
            if (list_obj.is_truncated) break;
        }
        return;
    }
    // for large dirs we cannot keep all entries in memory
    // so we have to stream the entries one by one while filtering only the needed ones.
    try {
        if (list_obj.list_type === '2') {
            // For unsorted listing dir position is used to when pagination split the items. 
            dbg.warn('NamespaceFS: open unsorted dir streaming', dir_path, 'size', cached_dir.stat.size, 'key_marker', list_obj.keymarker);
            dir_handle = await nb_native().fs.opendir(list_obj.fs_context, dir_path); //, { bufferSize: 128 });
            if (list_obj.keymarker.marker_pos) {
                await dir_handle.seekdir(list_obj.fs_context, BigInt(list_obj.keymarker.marker_pos));
                list_obj.keymarker.marker_pos = undefined;
            }
            await process_unsort_entry(bucket_path, bucket_id, dir_key, marker_curr, dir_path, list_obj, dir_handle);
        } else {
            dbg.warn('NamespaceFS: open dir streaming', dir_path, 'size', cached_dir.stat.size);
            dir_handle = await nb_native().fs.opendir(list_obj.fs_context, dir_path); //, { bufferSize: 128 });
            for (;;) {
                const dir_entry = await dir_handle.read(list_obj.fs_context);
                if (!dir_entry) break;
                await process_entry({bucket_path, bucket_id}, dir_entry, marker_curr, dir_path, dir_key, list_obj);
                // since we dir entries streaming order is not sorted,
                // we have to keep scanning all the keys before we can stop.
            }
        }
        await dir_handle.close(list_obj.fs_context);
        dir_handle = null;
    } finally {
        if (dir_handle) {
            try {
                dbg.warn('NamespaceFS: close dir streaming', dir_path, 'size', cached_dir.stat.size);
                await dir_handle.close(list_obj.fs_context);
            } catch (err) {
                dbg.error('NamespaceFS: close dir failed', err);
            }
            dir_handle = null;
        }
    }
}


function _get_filename(file_name) {
    if (_is_version_object(file_name)) {
        return file_name.substring(0, file_name.indexOf('_mtime-'));
    } else if (_is_version_null_version(file_name)) {
        return file_name.substring(0, file_name.indexOf(NULL_VERSION_SUFFIX));
    }
    return file_name;
}

/**
 *
 * @param {*} stat - entity stat yo check
 * @param {*} fs_context - account config using to check symbolic links
 * @param {*} entry_path - path of symbolic link
 * @returns
 */
async function is_directory_or_symlink_to_directory(stat, fs_context, entry_path) {
    try {
        let r = native_fs_utils.isDirectory(stat);
        if (!r && is_symbolic_link(stat)) {
            const targetStat = await nb_native().fs.stat(fs_context, entry_path);
            if (!targetStat) throw new Error('is_directory_or_symlink_to_directory: targetStat is empty');
            r = native_fs_utils.isDirectory(targetStat);
        }
        return r;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
}

/**
 * Return false if the entry is outside of the bucket
 * @param {*} fs_context
 * @param {*} entry_path
 * @param {string} bucket_path
 * @returns
 */
async function _is_path_in_bucket_boundaries(fs_context, entry_path, bucket_path) {
    dbg.log1('check_bucket_boundaries: fs_context', fs_context, 'file_path', entry_path, 'bucket_path', bucket_path);
    if (!entry_path.startsWith(bucket_path)) {
        dbg.log0('check_bucket_boundaries: the path', entry_path, 'is not in the bucket', bucket_path, 'boundaries');
        return false;
    }
    try {
        // Returns the real path of the entry.
        // The entry path may point to regular file or directory, but can have symbolic links  
        const full_path = await nb_native().fs.realpath(fs_context, entry_path);
        if (!full_path.startsWith(bucket_path)) {
            dbg.log0('check_bucket_boundaries: the full path', full_path, 'is not in the bucket', bucket_path, 'boundaries');
            return false;
        }
    } catch (err) {
        if (err.code === 'ENOTDIR') {
            dbg.warn('_is_path_in_bucket_boundaries: the path', entry_path, 'is not a directory');
            return true;
        }
        // Error: No such file or directory
        // In the upload use case, the destination file desn't exist yet, need to validate the parent dirs path.
        if (err.code === 'ENOENT') {
            return _is_path_in_bucket_boundaries(fs_context, path.dirname(entry_path), bucket_path);
        }
        // Read or search permission was denied for a component of the path prefix.
        if (err.code === 'EACCES') {
            return false;
        }
        throw error_utils.new_error_code('INTERNAL_ERROR',
            'check_bucket_boundaries error ' + err.code + ' ' + entry_path + ' ' + err, { cause: err });
    }
    return true;
}

/**
 * throws AccessDenied, if the entry is outside of the bucket
 * @param {*} fs_context
 * @param {*} entry_path
 * @param {string} bucket_path
 */
async function _check_path_in_bucket_boundaries(fs_context, entry_path, bucket_path) {
    if (!config.NSFS_CHECK_BUCKET_BOUNDARIES) return;
    if (!(await _is_path_in_bucket_boundaries(fs_context, entry_path, bucket_path))) {
        throw error_utils.new_error_code('EACCES', 'Entry ' + entry_path + ' is not in bucket boundaries');
    }
}

/**
 * Check access for fir path
 * @param {*} fs_context
 * @param {*} dir_path
 * @param {string} bucket_path
 */
async function check_access(fs_context, dir_path, bucket_path) {
    try {
        dbg.log0('check_access: dir_path', dir_path, 'fs_context', fs_context);
        await _check_path_in_bucket_boundaries(fs_context, dir_path, bucket_path);
        await nb_native().fs.checkAccess(fs_context, dir_path);
        return true;
    } catch (err) {
        dbg.error('check_access: error ', err.code, err, dir_path, bucket_path);
        const is_bucket_dir = dir_path === bucket_path;

        if (err.code === 'ENOTDIR' && !is_bucket_dir) {
            dbg.warn('check_access: the path', dir_path, 'is not a directory');
            return true;
        }
        // if dir_path is the bucket path we would like to throw an error
        // for other dirs we will skip
        if (['EPERM', 'EACCES'].includes(err.code) && !is_bucket_dir) {
            return false;
        }
        if (err.code === 'ENOENT' && !is_bucket_dir) {
            // invalidate if dir
            dir_cache.invalidate({ dir_path, fs_context });
            return false;
        }
        throw err;
    }
}

function _get_mtime_from_filename(filename) {
    if (!_is_version_object(filename)) {
        // Latest file wont have time suffix which will push the latest
        // object last in the list. So to keep the order maintained,
        // returning the latest time. Multiplying with 1e6 to provide
        // nano second precision
        return BigInt(Date.now() * 1e6);
    }
    const file_parts = filename.split('-');
    return size_utils.string_to_bigint(file_parts[file_parts.length - 3], 36);
}

// This is helper function for list object version
// In order to sort the entries by name we would like to change the name of files with suffix of '_null'
// to have the structure of _mtime-...-ino-... as version id.
// This function returns a set that contains all file names that were changed (after change)
// and an array old_versions_after_rename which is old_versions without the versions that stat failed on
async function _rename_null_version(old_versions, fs_context, version_path) {
    const renamed_null_versions_set = new Set();
    const old_versions_after_rename = [];

    for (const old_version of old_versions) {
        if (_is_version_null_version(old_version.name)) {
            try {
                const stat = await nb_native().fs.stat(fs_context, path.join(version_path, old_version.name));
                const mtime_ino = _get_version_id_by_stat(stat);
                const original_name = _get_filename(old_version.name);
                const version_with_mtime_ino = original_name + '_' + mtime_ino;
                old_version.name = version_with_mtime_ino;
                renamed_null_versions_set.add(version_with_mtime_ino);
            } catch (err) {
                // to cover an edge case where stat fails
                // for example another process deleted an object and we get ENOENT
                // just before executing this command but after the starting list object versions
                dbg.error(`_rename_null_version of ${old_version.name} got error:`, err);
                old_version.name = undefined;
            }
        }
        if (old_version.name) old_versions_after_rename.push(old_version);
    }
    return { renamed_null_versions_set, old_versions_after_rename };
}


/**
 * @param {fs.Dirent} first_entry
 * @param {fs.Dirent} second_entry
 * @returns {Number}
 */
function sort_entries_by_name_and_time(first_entry, second_entry) {
    const first_entry_name = _get_filename(first_entry.name);
    const second_entry_name = _get_filename(second_entry.name);
    if (first_entry_name === second_entry_name) {
        const first_entry_mtime = _get_mtime_from_filename(first_entry.name);
        const second_entry_mtime = _get_mtime_from_filename(second_entry.name);
        // To sort the versions in the latest first order,
        // below logic is followed
        if (second_entry_mtime < first_entry_mtime) return -1;
        if (second_entry_mtime > first_entry_mtime) return 1;
        return 0;
    } else {
        if (first_entry_name < second_entry_name) return -1;
        if (first_entry_name > second_entry_name) return 1;
        return 0;
    }
}

function to_xattr(fs_xattr) {
    const xattr = _.mapKeys(fs_xattr, (val, key) => {
        // Prioritize ignore list
        if (XATTR_METADATA_IGNORE_LIST.includes(key)) return '';

        // Fallback to rules

        if (key.startsWith(XATTR_USER_PREFIX) && !key.startsWith(XATTR_NOOBAA_INTERNAL_PREFIX)) {
            return key.slice(XATTR_USER_PREFIX.length);
        }

        return '';
    });

    // keys which do not start with prefix will all map to the empty string key, so we remove it once
    delete xattr[''];
    // @ts-ignore
    xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
    return xattr;
}


function is_symbolic_link(stat) {
    if (!stat) throw new Error('isSymbolicLink: stat is empty');
    if (stat.mode) {
        // eslint-disable-next-line no-bitwise
        return (((stat.mode) & nb_native().fs.S_IFMT) === nb_native().fs.S_IFLNK);
    } else if (stat.type) {
        return stat.type === nb_native().fs.DT_LNK;
    } else {
        throw new Error(`isSymbolicLink: stat ${stat} is not supported`);
    }
}

function _is_version_or_null_in_file_name(filename) {
    const is_version_object = _is_version_object(filename);
    if (!is_version_object) {
        return _is_version_null_version(filename);
    }
    return is_version_object;
}

function _is_version_object(filename) {
    const mtime_substr_index = filename.indexOf('_mtime-');
    if (mtime_substr_index < 0) return false;
    const ino_substr_index = filename.indexOf('-ino-');
    return ino_substr_index > mtime_substr_index;
}

function _is_version_null_version(filename) {
    return filename.endsWith(NULL_VERSION_SUFFIX);
}

/** 
 * @param {string} bucket_id
 * @returns {string}
 */
function get_bucket_tmpdir_name(bucket_id) {
    return native_fs_utils.get_bucket_tmpdir_name(bucket_id);
}

function _is_hidden_version_path(dir_key) {
    const idx = dir_key.indexOf(HIDDEN_VERSIONS_PATH);
    return ((idx === 0) || (idx > 0 && dir_key[idx - 1] === '/'));
}

/**
 * @param {string} dir_key
 * @param {fs.Dirent} ent
 * @returns {string}
 */
function _get_entry_key(dir_key, ent, isDir) {
    if (ent.name === config.NSFS_FOLDER_OBJECT_NAME) return dir_key;
    return dir_key + ent.name + (isDir ? '/' : '');
}

 /**
 * @param {string} dir_key
 * @param {fs.Dirent} ent
 * @returns {string}
 */
function _get_version_entry_key(dir_key, ent) {
    if (ent.name === config.NSFS_FOLDER_OBJECT_NAME) return dir_key;
    return dir_key + HIDDEN_VERSIONS_PATH + '/' + ent.name;
}

/**
 *
 * @param {string} file_path - fs context object
 * @param {string} key - fs_xattr object to be set on a directory
 * @returns {boolean} - describes if the file path describe a directory content
*/
function _is_directory_content(file_path, key) {
    return (file_path && file_path.endsWith(config.NSFS_FOLDER_OBJECT_NAME)) && (key && key.endsWith('/'));
}

/**
 * @param {fs.Dirent} e
 * @returns {string}
 */
function get_entry_name(e) {
    return e.name;
}

/**
 * @param {string} name
 * @returns {fs.Dirent}
 */
function make_named_dirent(name) {
    const entry = new fs.Dirent();
    entry.name = name;
    return entry;
}

/**
 * @param {fs.Dirent} a
 * @param {fs.Dirent} b
 * @returns {1|-1|0}
 */
function sort_entries_by_name(a, b) {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
}

function _get_version_id_by_stat({ino, mtimeNsBigint}) {
    // TODO: GPFS might require generation number to be added to version_id
    return 'mtime-' + mtimeNsBigint.toString(36) + '-ino-' + ino.toString(36);
}

/**
 * @returns {string}
 */
function _get_etag(stat) {
    const xattr_etag = _etag_from_fs_xattr(stat.xattr);
    if (xattr_etag) return xattr_etag;
    // IMPORTANT NOTICE - we must return an etag that contains a dash!
    // because this is the criteria of S3 SDK to decide if etag represents md5
    // and perform md5 validation of the data.
    return _get_version_id_by_stat(stat);
}

function _get_encryption_info(stat) {
    // Currently encryption is supported only on top of GPFS, otherwise we will return undefined
    return stat.xattr['gpfs.Encryption'] ? {
        algorithm: 'AES256',
        kms_key_id: '',
        context_b64: '',
        key_md5_b64: '',
        key_b64: '',
    } : undefined;
}

function _etag_from_fs_xattr(xattr) {
    if (_.isEmpty(xattr)) return undefined;
    return xattr[XATTR_MD5_KEY];
}

function _number_of_tags_fs_xttr(xattr) {
    return Object.keys(xattr).filter(xattr_key => xattr_key.includes(XATTR_TAG)).length;
}

/**
 * _get_object_owner in the future we will return object owner
 * currently not implemented because ACLs are not implemented as well
 */
function _get_object_owner() {
    return undefined;
}

exports.is_symbolic_link = is_symbolic_link;
exports.insert_unsort_entry_to_results_arr = insert_unsort_entry_to_results_arr;
exports.insert_entry_to_results_arr = insert_entry_to_results_arr;
exports.process_entry = process_entry;
exports.process_unsort_entry = process_unsort_entry;
exports.is_directory_or_symlink_to_directory = is_directory_or_symlink_to_directory;
exports._is_version_object = _is_version_object;
exports._is_version_null_version = _is_version_null_version;
exports._is_hidden_version_path = _is_hidden_version_path;
exports._get_filename = _get_filename;
exports.process_dir = process_dir;
exports.get_entry_name = get_entry_name;
exports.make_named_dirent = make_named_dirent;
exports.to_xattr = to_xattr;
exports.check_access = check_access;
exports._get_version_id_by_stat = _get_version_id_by_stat;
exports._get_etag = _get_etag;
exports._get_encryption_info = _get_encryption_info;
exports._number_of_tags_fs_xttr = _number_of_tags_fs_xttr;
exports._get_object_owner = _get_object_owner;
exports._check_path_in_bucket_boundaries = _check_path_in_bucket_boundaries;
exports._is_path_in_bucket_boundaries = _is_path_in_bucket_boundaries;
exports._is_directory_content = _is_directory_content;
exports._etag_from_fs_xattr = _etag_from_fs_xattr;

exports.NULL_VERSION_SUFFIX = NULL_VERSION_SUFFIX;
exports.NULL_VERSION_ID = NULL_VERSION_ID;
exports.NULL_VERSION_SUFFIX = NULL_VERSION_SUFFIX;
exports.HIDDEN_VERSIONS_PATH = HIDDEN_VERSIONS_PATH;
exports.XATTR_USER_PREFIX = XATTR_USER_PREFIX;
exports.XATTR_NOOBAA_INTERNAL_PREFIX = XATTR_NOOBAA_INTERNAL_PREFIX;
exports.XATTR_DIR_CONTENT = XATTR_DIR_CONTENT;
exports.XATTR_STORAGE_CLASS_KEY = XATTR_STORAGE_CLASS_KEY;
exports.XATTR_TAG = XATTR_TAG;
exports.XATTR_MD5_KEY = XATTR_MD5_KEY;
exports.XATTR_METADATA_IGNORE_LIST = XATTR_METADATA_IGNORE_LIST;
