/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const s3_utils = require('../endpoint/s3/s3_utils');
const size_utils = require('../util/size_utils');
const nb_native = require('../util/nb_native');
const config = require('../../config');
const path = require('path');
const _ = require('lodash');
const fs = require('fs');


///////////////////////////////////////
///       GENERAL NSFS UTILS        ///
///////////////////////////////////////

function isDirectory(ent) {
    if (!ent) throw new Error('isDirectory: ent is empty');
    if (ent.mode) {
        // eslint-disable-next-line no-bitwise
        return (((ent.mode) & nb_native().fs.S_IFMT) === nb_native().fs.S_IFDIR);
    } else if (ent.type) {
        return ent.type === nb_native().fs.DT_DIR;
    } else {
        throw new Error(`isDirectory: ent ${ent} is not supported`);
    }
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
        let r = isDirectory(stat);
        if (!r && is_symbolic_link(stat)) {
            const targetStat = await nb_native().fs.stat(fs_context, entry_path);
            if (!targetStat) throw new Error('is_directory_or_symlink_to_directory: targetStat is empty');
            r = isDirectory(targetStat);
        }
        return r;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
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


/**
 * @param {fs.Dirent} first_entry
 * @param {fs.Dirent} second_entry
 * @returns {Number}
 */
function sort_entries_by_name_and_time(first_entry, second_entry) {
    const first_entry_name = get_filename(first_entry.name);
    const second_entry_name = get_filename(second_entry.name);
    if (first_entry_name === second_entry_name) {
        const first_entry_mtime = get_mtime_from_filename(first_entry.name);
        const second_entry_mtime = get_mtime_from_filename(second_entry.name);
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


/**
 * NOTICE that even files that were written sequentially, can still be identified as sparse:
 * 1. After writing, but before all the data is synced, the size is higher than blocks size.
 * 2. For files that were moved to an archive tier.
 * 3. For files that fetch and cache data from remote storage, which are still not in the cache.
 * It's not good enough for avoiding recall storms as needed by _fail_if_archived_or_sparse_file.
 * However, using this check is useful for guessing that a reads is going to take more time
 * and avoid holding off large buffers from the buffers_pool.
 * @param {nb.NativeFSStats} stat
 * @returns {boolean}
 */
function is_sparse_file(stat) {
    return (stat.blocks * 512 < stat.size);
}


function get_umasked_mode(mode) {
    // eslint-disable-next-line no-bitwise
    return mode & ~config.NSFS_UMASK;
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


///////////////////////////////////////
///        XATTR NSFS UTILS         ///
///////////////////////////////////////

const XATTR_USER_PREFIX = 'user.';
// TODO: In order to verify validity add content_md5_mtime as well
const XATTR_CONTENT_TYPE = XATTR_USER_PREFIX + 'content_type';
const XATTR_MD5_KEY = XATTR_USER_PREFIX + 'content_md5';
const XATTR_DIR_CONTENT = XATTR_USER_PREFIX + 'dir_content';

const XATTR_VERSION_ID = XATTR_USER_PREFIX + 'version_id';
const XATTR_PREV_VERSION_ID = XATTR_USER_PREFIX + 'prev_version_id';
const XATTR_DELETE_MARKER = XATTR_USER_PREFIX + 'delete_marker';

const INTERNAL_XATTR = [
    XATTR_CONTENT_TYPE,
    XATTR_DIR_CONTENT,
    XATTR_PREV_VERSION_ID,
    XATTR_DELETE_MARKER,
];

function to_xattr(fs_xattr) {
    const xattr = _.mapKeys(fs_xattr, (val, key) =>
        (key.startsWith(XATTR_USER_PREFIX) && !INTERNAL_XATTR.includes(key) ? key.slice(XATTR_USER_PREFIX.length) : '')
    );
    // keys which do not start with prefix will all map to the empty string key, so we remove it once
    delete xattr[''];
    // @ts-ignore
    xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
    return xattr;
}

function to_fs_xattr(xattr) {
    if (_.isEmpty(xattr)) return undefined;
    return _.mapKeys(xattr, (val, key) => XATTR_USER_PREFIX + key);
}

///////////////////////////////////////
///      VERSIONING NSFS UTILS      ///
///////////////////////////////////////

const NULL_VERSION_ID = 'null';
const NULL_VERSION_SUFFIX = '_' + NULL_VERSION_ID;

function get_version_id_by_stat({ino, mtimeNsBigint}) {
    // TODO: GPFS might require generation number to be added to version_id
    return 'mtime-' + mtimeNsBigint.toString(36) + '-ino-' + ino.toString(36);
}

function is_version_str_including_null_version(filename) {
    const is_version_str = is_version_string(filename);
    if (!is_version_str) {
        return is_version_null_version(filename);
    }
    return is_version_str;
}

function is_version_null_version(filename) {
    return filename.endsWith(NULL_VERSION_SUFFIX);
}

function is_version_string(filename) {
    const mtime_substr_index = filename.indexOf('_mtime-');
    if (mtime_substr_index < 0) return false;
    const ino_substr_index = filename.indexOf('-ino-');
    return ino_substr_index > mtime_substr_index;
}

function get_mtime_from_filename(filename) {
    if (!is_version_string(filename)) {
        // Latest file wont have time suffix which will push the latest
        // object last in the list. So to keep the order maintained,
        // returning the latest time. Multiplying with 1e6 to provide
        // nano second precision
        return BigInt(Date.now() * 1e6);
    }
    const file_parts = filename.split('-');
    return size_utils.string_to_bigint(file_parts[file_parts.length - 3], 36);
}

function get_filename(file_name) {
    if (is_version_string(file_name)) {
        return file_name.substring(0, file_name.indexOf('_mtime-'));
    } else if (is_version_null_version(file_name)) {
        return file_name.substring(0, file_name.indexOf(NULL_VERSION_SUFFIX));
    }
    return file_name;
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
        if (is_version_null_version(old_version.name)) {
            try {
                const stat = await nb_native().fs.stat(fs_context, path.join(version_path, old_version.name));
                const mtime_ino = get_version_id_by_stat(stat);
                const original_name = get_filename(old_version.name);
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

exports.isDirectory = isDirectory;
exports.is_directory_or_symlink_to_directory = is_directory_or_symlink_to_directory;
exports.is_symbolic_link = is_symbolic_link;
exports.sort_entries_by_name = sort_entries_by_name;
exports.sort_entries_by_name_and_time = sort_entries_by_name_and_time;
exports.is_sparse_file = is_sparse_file;
exports.get_umasked_mode = get_umasked_mode;
exports.get_entry_name = get_entry_name;
// xattr
exports.make_named_dirent = make_named_dirent;
exports.to_xattr = to_xattr;
exports.to_fs_xattr = to_fs_xattr;
exports.XATTR_USER_PREFIX = XATTR_USER_PREFIX;
exports.XATTR_CONTENT_TYPE = XATTR_CONTENT_TYPE;
exports.XATTR_MD5_KEY = XATTR_MD5_KEY;
exports.XATTR_DIR_CONTENT = XATTR_DIR_CONTENT;
// versioning
exports.NULL_VERSION_ID = NULL_VERSION_ID;
exports.NULL_VERSION_SUFFIX = NULL_VERSION_SUFFIX;
exports.XATTR_VERSION_ID = XATTR_VERSION_ID;
exports.XATTR_PREV_VERSION_ID = XATTR_PREV_VERSION_ID;
exports.XATTR_DELETE_MARKER = XATTR_DELETE_MARKER;
exports.get_version_id_by_stat = get_version_id_by_stat;
exports.is_version_str_including_null_version = is_version_str_including_null_version;
exports.is_version_null_version = is_version_null_version;
exports.is_version_string = is_version_string;
exports.get_mtime_from_filename = get_mtime_from_filename;
exports.get_filename = get_filename;
exports._rename_null_version = _rename_null_version;
