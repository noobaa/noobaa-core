/* Copyright (C) 2020 NooBaa */
/*eslint max-lines: ["error", 4000]*/
/*eslint max-statements: ["error", 80, { "ignoreTopLevelFunctions": true }]*/
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const mime = require('mime');
const { v4: uuidv4 } = require('uuid');
const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const s3_utils = require('../endpoint/s3/s3_utils');
const error_utils = require('../util/error_utils');
const stream_utils = require('../util/stream_utils');
const buffer_utils = require('../util/buffer_utils');
const size_utils = require('../util/size_utils');
const native_fs_utils = require('../util/native_fs_utils');
const ChunkFS = require('../util/chunk_fs');
const LRUCache = require('../util/lru_cache');
const nb_native = require('../util/nb_native');
const RpcError = require('../rpc/rpc_error');
const { S3Error } = require('../endpoint/s3/s3_errors');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const { PersistentLogger } = require('../util/persistent_logger');
const { GlacierBackend } = require('./nsfs_glacier_backend/backend');

const multi_buffer_pool = new buffer_utils.MultiSizeBuffersPool({
    sorted_buf_sizes: [
        {
            size: config.NSFS_BUF_SIZE_XS,
            sem_size: config.NSFS_BUF_POOL_MEM_LIMIT_XS,
        }, {
            size: config.NSFS_BUF_SIZE_S,
            sem_size: config.NSFS_BUF_POOL_MEM_LIMIT_S,
        }, {
            size: config.NSFS_BUF_SIZE_M,
            sem_size: config.NSFS_BUF_POOL_MEM_LIMIT_M,
        }, {
            size: config.NSFS_BUF_SIZE_L,
            sem_size: config.NSFS_BUF_POOL_MEM_LIMIT_L,
        },
    ],
    warning_timeout: config.NSFS_BUF_POOL_WARNING_TIMEOUT,
    sem_timeout: config.IO_STREAM_SEMAPHORE_TIMEOUT,
    sem_timeout_error_code: 'IO_STREAM_ITEM_TIMEOUT',
    sem_warning_timeout: config.NSFS_SEM_WARNING_TIMEOUT,
    buffer_alloc: size => nb_native().fs.dio_buffer_alloc(size),
});

const XATTR_USER_PREFIX = 'user.';
const XATTR_NOOBAA_INTERNAL_PREFIX = XATTR_USER_PREFIX + 'noobaa.';
const XATTR_NOOBAA_CUSTOM_PREFIX = XATTR_NOOBAA_INTERNAL_PREFIX + 'tag.';
// TODO: In order to verify validity add content_md5_mtime as well
const XATTR_MD5_KEY = XATTR_USER_PREFIX + 'content_md5';
const XATTR_CONTENT_TYPE = XATTR_NOOBAA_INTERNAL_PREFIX + 'content_type';
const XATTR_PART_OFFSET = XATTR_NOOBAA_INTERNAL_PREFIX + 'part_offset';
const XATTR_PART_SIZE = XATTR_NOOBAA_INTERNAL_PREFIX + 'part_size';
const XATTR_PART_ETAG = XATTR_NOOBAA_INTERNAL_PREFIX + 'part_etag';
const XATTR_VERSION_ID = XATTR_NOOBAA_INTERNAL_PREFIX + 'version_id';
const XATTR_PREV_VERSION_ID = XATTR_NOOBAA_INTERNAL_PREFIX + 'prev_version_id';
const XATTR_DELETE_MARKER = XATTR_NOOBAA_INTERNAL_PREFIX + 'delete_marker';
const XATTR_DIR_CONTENT = XATTR_NOOBAA_INTERNAL_PREFIX + 'dir_content';
const HIDDEN_VERSIONS_PATH = '.versions';
const NULL_VERSION_ID = 'null';
const NULL_VERSION_SUFFIX = '_' + NULL_VERSION_ID;
const XATTR_STORAGE_CLASS_KEY = XATTR_USER_PREFIX + 'storage_class';

const versioning_status_enum = {
    VER_ENABLED: 'ENABLED',
    VER_SUSPENDED: 'SUSPENDED',
    VER_DISABLED: 'DISABLED'
};
const version_format = /^[a-z0-9]+$/;

// describes the status of the copy that was done, default is fallback
// LINKED = the file was linked on the server side
// IS_SAME_INODE = source and target are the same inode, nothing to copy
// FALLBACK = will be reported when link on server side copy failed
// or on non server side copy
const copy_status_enum = {
    LINKED: 'LINKED',
    SAME_INODE: 'SAME_INODE',
    FALLBACK: 'FALLBACK'
};

const XATTR_METADATA_IGNORE_LIST = [
    XATTR_STORAGE_CLASS_KEY,
];

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

function _is_version_object_including_null_version(filename) {
    const is_version_object = _is_version_object(filename);
    if (!is_version_object) {
        return _is_version_null_version(filename);
    }
    return is_version_object;
}

function _is_version_null_version(filename) {
    return filename.endsWith(NULL_VERSION_SUFFIX);
}

function _is_version_object(filename) {
    const mtime_substr_index = filename.indexOf('_mtime-');
    if (mtime_substr_index < 0) return false;
    const ino_substr_index = filename.indexOf('-ino-');
    return ino_substr_index > mtime_substr_index;
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

function _get_filename(file_name) {
    if (_is_version_object(file_name)) {
        return file_name.substring(0, file_name.indexOf('_mtime-'));
    } else if (_is_version_null_version(file_name)) {
        return file_name.substring(0, file_name.indexOf(NULL_VERSION_SUFFIX));
    }
    return file_name;
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

function to_fs_xattr(xattr) {
    if (_.isEmpty(xattr)) return undefined;
    return _.mapKeys(xattr, (val, key) => XATTR_USER_PREFIX + key);
}


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
        if (ver_dir_stat) {
            const versions_dir_path = path.normalize(path.join(dir_path, '/', HIDDEN_VERSIONS_PATH));
            const new_versions_stat = await nb_native().fs.stat(fs_context, versions_dir_path);
            return (new_stat.ino === stat.ino &&
                    new_stat.mtimeNsBigint === stat.mtimeNsBigint &&
                    new_versions_stat.ino === ver_dir_stat.ino &&
                    new_versions_stat.mtimeNsBigint === ver_dir_stat.mtimeNsBigint);
        } else {
            return (new_stat.ino === stat.ino &&
            new_stat.mtimeNsBigint === stat.mtimeNsBigint);
        }
    },
    item_usage: ({ usage }, dir_path) => usage,
    max_usage: config.NSFS_DIR_CACHE_MAX_TOTAL_SIZE,
});

/**
 * @typedef {{
 *  statfs: Record<string, number>
 * }} NsfsBucketStatFsCache
 * @type {LRUCache<object, string, NsfsBucketStatFsCache>}
 */
const nsfs_bucket_statfs_cache = new LRUCache({
    name: 'nsfs-bucket-statfs',
    make_key: ({ bucket_path }) => bucket_path,
    load: async ({ bucket_path, fs_context }) => {
        const statfs = await nb_native().fs.statfs(fs_context, bucket_path);
        return { statfs };
    },
    // validate - no need, validation will be as costly as `load`,
    // instead let the item expire
    expiry_ms: config.NSFS_STATFS_CACHE_EXPIRY_MS,
    max_usage: config.NSFS_STATFS_CACHE_SIZE,
});


const nsfs_low_space_fsids = new Set();

/**
 * NamespaceFS map objets to files in a filesystem.
 * @implements {nb.Namespace}
 */
class NamespaceFS {

    /**
     * @param {{
     *  bucket_path: string;
     *  fs_backend?: string;
     *  bucket_id: string;
     *  namespace_resource_id?: string;
     *  access_mode: string;
     *  versioning: 'DISABLED' | 'SUSPENDED' | 'ENABLED';
     *  stats: import('./endpoint_stats_collector').EndpointStatsCollector;
     *  force_md5_etag: boolean;
     * }} params
     */
    constructor({
        bucket_path,
        fs_backend,
        bucket_id,
        namespace_resource_id,
        access_mode,
        versioning,
        stats,
        force_md5_etag,
    }) {
        dbg.log0('NamespaceFS: buffers_pool ',
            multi_buffer_pool.pools);
        this.bucket_path = path.resolve(bucket_path);
        this.fs_backend = fs_backend;
        this.bucket_id = bucket_id;
        this.namespace_resource_id = namespace_resource_id;
        this.access_mode = access_mode;
        this.versioning = (config.NSFS_VERSIONING_ENABLED && versioning) || versioning_status_enum.VER_DISABLED;
        this.stats = stats;
        this.force_md5_etag = force_md5_etag;
        this.warmup_buffer = nb_native().fs.dio_buffer_alloc(4096);
    }

    /**
     * @param {nb.ObjectSDK} object_sdk 
     * @returns {nb.NativeFSContext}
     */
    prepare_fs_context(object_sdk) {
        const fs_context = object_sdk?.requesting_account?.nsfs_account_config;
        if (!fs_context) throw new RpcError('UNAUTHORIZED', 'nsfs_account_config is missing');
        fs_context.backend = this.fs_backend || '';
        fs_context.warn_threshold_ms = config.NSFS_WARN_THRESHOLD_MS;
        if (this.stats) fs_context.report_fs_stats = this.stats.update_fs_stats;
        return fs_context;
    }

    /**
     * @returns {string}
     */
    get_bucket_tmpdir_name() {
        return native_fs_utils.get_bucket_tmpdir_name(this.bucket_id);
    }

    /**
     * @returns {string}
     */
    get_bucket_tmpdir_full_path() {
        return native_fs_utils.get_bucket_tmpdir_full_path(this.bucket_path, this.bucket_id);
    }

    get_write_resource() {
        return this;
    }

    get_bucket(bucket) {
        return bucket;
    }

    is_server_side_copy(other, other_md, params) {
        const is_server_side_copy = other instanceof NamespaceFS &&
            other.bucket_path === this.bucket_path &&
            other.fs_backend === this.fs_backend && // Check that the same backend type
            params.xattr_copy && // TODO, DO we need to hard link at MetadataDirective 'REPLACE'?
            params.content_type === other_md.content_type;
        dbg.log2('NamespaceFS: is_server_side_copy:', is_server_side_copy);
        dbg.log2('NamespaceFS: other instanceof NamespaceFS:', other instanceof NamespaceFS,
            'other.bucket_path:', other.bucket_path, 'this.bucket_path:', this.bucket_path,
            'other.fs_backend', other.fs_backend, 'this.fs_backend', this.fs_backend,
            'params.xattr_copy', params.xattr_copy);
        return is_server_side_copy;
    }

    run_update_issues_report(object_sdk, err) {
        if (!config.NSFS_UPDATE_ISSUES_REPORT_ENABLED) {
            dbg.log0('update_issues_report disabled:', this.namespace_resource_id, err);
            return;
        }
        //We want to avoid the report when we have no error code.
        if (!err.code) return;
        //In standalone, we want to avoid the report.
        if (!this.namespace_resource_id) return;
        try {
            object_sdk.rpc_client.pool.update_issues_report({
                namespace_resource_id: this.namespace_resource_id,
                error_code: err.code,
                time: Date.now(),
            });
        } catch (e) {
            console.log('update_issues_report on error:', e, 'ignoring.');
        }
    }

    /**
     * _should_update_issues_report is intended to avoid updating the namespace issues report in case:
     * 1. The key doesn't exist and the path is not internal -
     *    internal path is created for specific cases, for example in version.
     *    Note: it also covers the delete marker case (since it is in a versioned path)
     * IMPORTANT: This function is correct only for read_object_md!
     * @param {object} params
     * @param {string} file_path
     * @param {object} err
     */
    _should_update_issues_report(params, file_path, err) {
        const { key } = params;
        const md_file_path = this._get_file_md_path({ key });
        const non_internal_path = file_path === md_file_path;
        const no_such_key_condition = err.code === `ENOENT` && non_internal_path;
        return !no_such_key_condition;
    }

    is_readonly_namespace() {
        return this.access_mode === 'READ_ONLY';
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    /**
     * @typedef {{
     *  bucket: string,
     *  prefix?: string,
     *  delimiter?: string,
     *  key_marker?: string,
     *  limit?: number,
     * }} ListParams
     */

    /**
     * @param {ListParams} params
     */
    async list_objects(params, object_sdk) {
        const object_info = await this._list_objects(params, object_sdk, false);
        return object_info;
    }

    /**
     * @typedef {{
     *  bucket: string,
     *  prefix?: string,
     *  delimiter?: string,
     *  key_marker?: string,
     *  version_id_marker?: string,
     *  limit?: number,
     * }} ListVersionsParams
     */
    /**
     * @param {ListVersionsParams} params
     */
    async list_object_versions(params, object_sdk) {
        return this._list_objects(params, object_sdk, true);
    }

    async _list_objects(params, object_sdk, list_versions) {
        try {
            const fs_context = this.prepare_fs_context(object_sdk);
            await this._load_bucket(params, fs_context);

            const {
                bucket,
                delimiter = '',
                prefix = '',
                version_id_marker = '',
                key_marker = '',
            } = params;

            if (delimiter && delimiter !== '/') {
                throw new Error('NamespaceFS: Invalid delimiter ' + delimiter);
            }
            const limit = Math.min(1000, _.isUndefined(params.limit) ? 1000 : params.limit);
            if (limit < 0) throw new Error('Limit must be a positive Integer');
            // In case that we've received max-keys 0, we should return an empty reply without is_truncated
            // This is used in order to follow aws spec and behaviour
            if (!limit) return { is_truncated: false, objects: [], common_prefixes: [] };

            let is_truncated = false;

            /**
             * @typedef {{
             *  key: string,
             *  common_prefix: boolean,
             *  stat?: nb.NativeFSStats,
             * }} Result
             */

            /** @type {Result[]} */
            const results = [];

            /**
             * @param {string} dir_key
             * @returns {Promise<void>}
             */
            const process_dir = async dir_key => {
                if (this._is_hidden_version_path(dir_key)) {
                    return;
                }
                // /** @type {fs.Dir} */
                let dir_handle;
                /** @type {ReaddirCacheItem} */
                let cached_dir;
                const dir_path = path.join(this.bucket_path, dir_key);
                const prefix_dir = prefix.slice(0, dir_key.length);
                const prefix_ent = prefix.slice(dir_key.length);
                if (!dir_key.startsWith(prefix_dir)) {
                    // dbg.log0(`prefix dir does not match so no keys in this dir can apply: dir_key=${dir_key} prefix_dir=${prefix_dir}`);
                    return;
                }
                const marker_dir = key_marker.slice(0, dir_key.length);
                const marker_ent = key_marker.slice(dir_key.length);
                // marker is after dir so no keys in this dir can apply
                if (dir_key < marker_dir) {
                    // dbg.log0(`marker is after dir so no keys in this dir can apply: dir_key=${dir_key} marker_dir=${marker_dir}`);
                    return;
                }
                // when the dir portion of the marker is completely below the current dir
                // then every key in this dir satisfies the marker and marker_ent should not be used.
                const marker_curr = (marker_dir < dir_key) ? '' : marker_ent;
                // dbg.log0(`process_dir: dir_key=${dir_key} prefix_ent=${prefix_ent} marker_curr=${marker_curr}`);
                /**
                 * @typedef {{
                 *  key: string,
                 *  common_prefix: boolean
                 * }}
                 */
                const insert_entry_to_results_arr = async r => {
                    let pos;
                    // Since versions are arranged next to latest object in the latest first order,
                    // no need to find the sorted last index. Push the ".versions/#VERSION_OBJECT" as
                    // they are in order
                    if (results.length && r.key < results[results.length - 1].key &&
                        !this._is_hidden_version_path(r.key)) {
                        pos = _.sortedLastIndexBy(results, r, a => a.key);
                    } else {
                        pos = results.length;
                    }

                    if (pos >= limit) {
                        is_truncated = true;
                        return; // not added
                    }
                    if (!delimiter && r.common_prefix) {
                        await process_dir(r.key);
                    } else {
                        if (pos < results.length) {
                            results.splice(pos, 0, r);
                        } else {
                            results.push(r);
                        }
                        if (results.length > limit) {
                            results.length = limit;
                            is_truncated = true;
                        }
                    }
                };

                /**
                 * @param {fs.Dirent} ent
                 */
                const process_entry = async ent => {
                    // dbg.log0('process_entry', dir_key, ent.name);
                    if ((!ent.name.startsWith(prefix_ent) ||
                        ent.name < marker_curr ||
                        ent.name === this.get_bucket_tmpdir_name() ||
                        ent.name === config.NSFS_FOLDER_OBJECT_NAME) ||
                        this._is_hidden_version_path(ent.name)) {
                        return;
                    }
                    const isDir = await is_directory_or_symlink_to_directory(ent, fs_context, path.join(dir_path, ent.name));

                    let r;
                    if (list_versions && _is_version_object_including_null_version(ent.name)) {
                        r = {
                            key: this._get_version_entry_key(dir_key, ent),
                            common_prefix: isDir,
                        };
                    } else {
                        r = {
                            key: this._get_entry_key(dir_key, ent, isDir),
                            common_prefix: isDir,
                        };
                    }
                    await insert_entry_to_results_arr(r);
                };

                if (!(await this.check_access(fs_context, dir_path))) return;
                try {
                    if (list_versions) {
                        cached_dir = await versions_dir_cache.get_with_cache({ dir_path, fs_context });
                    } else {
                        cached_dir = await dir_cache.get_with_cache({ dir_path, fs_context });
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
                if (is_dir_content && dir_key > key_marker && (!delimiter || dir_key === prefix)) {
                    const r = { key: dir_key, common_prefix: false };
                    await insert_entry_to_results_arr(r);
                }

                if (cached_dir.sorted_entries) {
                    const sorted_entries = cached_dir.sorted_entries;
                    let marker_index;
                    // Two ways followed here to find the index.
                    // 1. When inside marker_dir: Here the entries are sorted based on time. Here
                    //    FindIndex() is called since sortedLastIndexBy() expects sorted order by name
                    // 2. When marker_dir above dir_path: sortedLastIndexBy() is called since entries are
                    //     sorted by name
                    // 3. One of the below conditions, marker_curr.includes('/') checks whether
                    //    the call is for the directory that contains marker_curr
                    if (list_versions && marker_curr && !marker_curr.includes('/')) {
                        let start_marker = marker_curr;
                        if (version_id_marker) start_marker = version_id_marker;
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
                    if (marker_index) {
                        const prev_dir = sorted_entries[marker_index - 1];
                        const prev_dir_name = prev_dir.name;
                        if (marker_curr.startsWith(prev_dir_name) && dir_key !== prev_dir.name) {
                            if (!delimiter) {
                                const isDir = await is_directory_or_symlink_to_directory(
                                    prev_dir, fs_context, path.join(dir_path, prev_dir_name, '/'));
                                if (isDir) {
                                    await process_dir(path.join(dir_key, prev_dir_name, '/'));
                                }
                            }
                        }
                    }
                    for (let i = marker_index; i < sorted_entries.length; ++i) {
                        const ent = sorted_entries[i];
                        if (list_versions && marker_curr) {
                            const ent_name = _get_filename(ent.name);
                            if (ent_name !== marker_curr) break;
                        }
                        // when entry is NSFS_FOLDER_OBJECT_NAME=.folder file,
                        // and the dir key marker is the name of the curr directory - skip on adding it
                        if (ent.name === config.NSFS_FOLDER_OBJECT_NAME && dir_key === marker_dir) {
                            continue;
                        }
                        await process_entry(ent);
                        // since we traverse entries in sorted order,
                        // we can break as soon as enough keys are collected.
                        if (is_truncated) break;
                    }
                    return;
                }
                // for large dirs we cannot keep all entries in memory
                // so we have to stream the entries one by one while filtering only the needed ones.
                try {
                    dbg.warn('NamespaceFS: open dir streaming', dir_path, 'size', cached_dir.stat.size);
                    dir_handle = await nb_native().fs.opendir(fs_context, dir_path); //, { bufferSize: 128 });
                    for (;;) {
                        const dir_entry = await dir_handle.read(fs_context);
                        if (!dir_entry) break;
                        await process_entry(dir_entry);
                        // since we dir entries streaming order is not sorted,
                        // we have to keep scanning all the keys before we can stop.
                    }
                    await dir_handle.close(fs_context);
                    dir_handle = null;
                } finally {
                    if (dir_handle) {
                        try {
                            dbg.warn('NamespaceFS: close dir streaming', dir_path, 'size', cached_dir.stat.size);
                            await dir_handle.close(fs_context);
                        } catch (err) {
                            dbg.error('NamespaceFS: close dir failed', err);
                        }
                        dir_handle = null;
                    }
                }
            };

            const prefix_dir_key = prefix.slice(0, prefix.lastIndexOf('/') + 1);
            await process_dir(prefix_dir_key);
            await Promise.all(results.map(async r => {
                if (r.common_prefix) return;
                const entry_path = path.join(this.bucket_path, r.key);
                //If entry is outside of bucket, returns stat of symbolic link
                const use_lstat = !(await this._is_path_in_bucket_boundaries(fs_context, entry_path));
                r.stat = await nb_native().fs.stat(fs_context, entry_path, { use_lstat });
            }));
            const res = {
                objects: [],
                common_prefixes: [],
                is_truncated,
                next_marker: undefined,
                next_version_id_marker: undefined,
            };
            for (const r of results) {
                let obj_info;
                if (r.common_prefix) {
                    res.common_prefixes.push(r.key);
                } else {
                    obj_info = this._get_object_info(bucket, r.key, r.stat, 'null', false, true);
                    if (!list_versions && obj_info.delete_marker) {
                        continue;
                    }
                    if (this._is_hidden_version_path(obj_info.key)) {
                        obj_info.key = path.normalize(obj_info.key.replace(HIDDEN_VERSIONS_PATH + '/', ''));
                        obj_info.key = _get_filename(obj_info.key);
                    }
                    res.objects.push(obj_info);
                }
                if (res.is_truncated) {
                    if (list_versions && _is_version_object(r.key)) {
                        const next_version_id_marker = r.key.substring(r.key.lastIndexOf('/') + 1);
                        res.next_version_id_marker = next_version_id_marker;
                        res.next_marker = _get_filename(next_version_id_marker);
                    } else {
                        res.next_marker = r.key;
                    }
                }
            }
            return res;
        } catch (err) {
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    async read_object_md(params, object_sdk) {
        const fs_context = this.prepare_fs_context(object_sdk);
        let file_path;
        try {
            file_path = await this._find_version_path(fs_context, params, true);
            await this._check_path_in_bucket_boundaries(fs_context, file_path);
            await this._load_bucket(params, fs_context);
            let stat = await nb_native().fs.stat(fs_context, file_path);

            const isDir = native_fs_utils.isDirectory(stat);
            if (isDir) {
                if (!stat.xattr?.[XATTR_DIR_CONTENT] || !params.key.endsWith('/')) {
                    throw error_utils.new_error_code('ENOENT', 'NoSuchKey');
                } else if (stat.xattr?.[XATTR_DIR_CONTENT] !== '0') {
                    // find dir object content file path  and return its stat + xattr of its parent directory
                    const dir_content_path = await this._find_version_path(fs_context, params);
                    const dir_content_path_stat = await nb_native().fs.stat(fs_context, dir_content_path);
                    const xattr = stat.xattr;
                    stat = { ...dir_content_path_stat, xattr };
                }
            }
            this._throw_if_delete_marker(stat);
            return this._get_object_info(params.bucket, params.key, stat, params.version_id || 'null', isDir);
        } catch (err) {
            if (this._should_update_issues_report(params, file_path, err)) {
                this.run_update_issues_report(object_sdk, err);
            }
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
    }

    // eslint-disable-next-line max-statements
    async read_object_stream(params, object_sdk, res) {
        let file;
        let buffer_pool_cleanup = null;
        const fs_context = this.prepare_fs_context(object_sdk);
        let file_path;
        try {
            await this._load_bucket(params, fs_context);
            file_path = await this._find_version_path(fs_context, params);
            await this._check_path_in_bucket_boundaries(fs_context, file_path);

            // NOTE: don't move this code after the open
            // this can lead to ENOENT failures due to file not exists when content size is 0
            // if entry is a directory object and its content size = 0 - return empty response
            const is_dir_content = this._is_directory_content(file_path, params.key);
            if (is_dir_content) {
                try {
                    const md_path = this._get_file_md_path(params);
                    const dir_stat = await nb_native().fs.stat(fs_context, md_path);
                    if (dir_stat && dir_stat.xattr[XATTR_DIR_CONTENT] === '0') return null;
                } catch (err) {
                    //failed to get object
                    new NoobaaEvent(NoobaaEvent.OBJECT_GET_FAILED).create_event(params.key,
                                            {bucket_path: this.bucket_path, object_name: params.key}, err);
                    dbg.log0('NamespaceFS: read_object_stream couldnt find dir content xattr', err);
                }
            }

            file = await nb_native().fs.open(
                fs_context,
                file_path,
                config.NSFS_OPEN_READ_MODE,
                native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE),
            );

            const stat = await file.stat(fs_context);
            this._throw_if_delete_marker(stat);
            // await this._fail_if_archived_or_sparse_file(fs_context, file_path, stat);

            const start = Number(params.start) || 0;
            const end = isNaN(Number(params.end)) ? Infinity : Number(params.end);

            let num_bytes = 0;
            let num_buffers = 0;
            const log2_size_histogram = {};
            let drain_promise = null;

            dbg.log0('NamespaceFS: read_object_stream', {
                file_path, start, end, size: stat.size,
            });

            let count = 1;
            for (let pos = start; pos < end;) {
                object_sdk.throw_if_aborted();

                // Our buffer pool keeps large buffers and we want to avoid spending
                // all our large buffers and then have them waiting for high latency calls
                // such as reading from archive/on-demand cache files.
                // Instead, we detect the case where a file is "sparse",
                // and then use just a small buffer to wait for a tiny read,
                // which will recall the file from archive or load from remote into cache,
                // and once it returns we can continue to the full fledged read.
                if (config.NSFS_BUF_WARMUP_SPARSE_FILE_READS && is_sparse_file(stat)) {
                    dbg.log0('NamespaceFS: read_object_stream - warmup sparse file', {
                        file_path, pos, size: stat.size, blocks: stat.blocks,
                    });
                    await file.read(fs_context, this.warmup_buffer, 0, 1, pos);
                }

                const remain_size = Math.min(Math.max(0, end - pos), stat.size);

                // allocate or reuse buffer
                // TODO buffers_pool and the underlying semaphore should support abort signal
                // to avoid sleeping inside the semaphore until the timeout while the request is already aborted.
                const { buffer, callback } = await multi_buffer_pool.get_buffers_pool(remain_size).get_buffer();
                buffer_pool_cleanup = callback; // must be called ***IMMEDIATELY*** after get_buffer
                object_sdk.throw_if_aborted();

                // read from file
                const read_size = Math.min(buffer.length, remain_size);
                const bytesRead = await file.read(fs_context, buffer, 0, read_size, pos);
                if (!bytesRead) {
                    buffer_pool_cleanup = null;
                    callback();
                    break;
                }
                object_sdk.throw_if_aborted();
                const data = buffer.slice(0, bytesRead);

                // update stats
                pos += bytesRead;
                num_bytes += bytesRead;
                num_buffers += 1;
                const log2_size = Math.ceil(Math.log2(bytesRead));
                log2_size_histogram[log2_size] = (log2_size_histogram[log2_size] || 0) + 1;

                // collect read stats
                this.stats?.update_nsfs_read_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    bucket_name: params.bucket,
                    size: bytesRead,
                    count
                });
                // clear count for next updates
                count = 0;

                // wait for response buffer to drain before adding more data if needed -
                // this occurs when the output network is slower than the input file
                if (drain_promise) {
                    await drain_promise;
                    drain_promise = null;
                    object_sdk.throw_if_aborted();
                }

                // write the data out to response
                buffer_pool_cleanup = null; // cleanup is now in the socket responsibility
                const write_ok = res.write(data, null, callback);
                if (!write_ok) {
                    drain_promise = stream_utils.wait_drain(res, { signal: object_sdk.abort_controller.signal });
                    drain_promise.catch(() => undefined); // this avoids UnhandledPromiseRejection
                }
            }

            await file.close(fs_context);
            file = null;
            object_sdk.throw_if_aborted();

            // wait for the last drain if pending.
            if (drain_promise) {
                await drain_promise;
                drain_promise = null;
                object_sdk.throw_if_aborted();
            }

            // end the stream
            res.end();

            await stream_utils.wait_finished(res, { signal: object_sdk.abort_controller.signal });
            object_sdk.throw_if_aborted();

            dbg.log0('NamespaceFS: read_object_stream completed file', file_path, {
                num_bytes,
                num_buffers,
                avg_buffer: num_bytes / num_buffers,
                log2_size_histogram,
            });

            // return null to signal the caller that we already handled the response
            return null;

        } catch (err) {
            dbg.log0('NamespaceFS: read_object_stream error file', file_path, err);
            //failed to get object
            new NoobaaEvent(NoobaaEvent.OBJECT_STREAM_GET_FAILED).create_event(params.key,
                                    {bucket_path: this.bucket_path, object_name: params.key}, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);

        } finally {
            try {
                if (file) {
                    dbg.log0('NamespaceFS: read_object_stream finally closing file', file_path);
                    await file.close(fs_context);
                }
            } catch (err) {
                dbg.warn('NamespaceFS: read_object_stream file close error', err);
            }
            try {
                // release buffer back to pool if needed
                if (buffer_pool_cleanup) {
                    dbg.log0('NamespaceFS: read_object_stream finally buffer_pool_cleanup', file_path);
                    buffer_pool_cleanup();
                }
            } catch (err) {
                //failed to get object
                new NoobaaEvent(NoobaaEvent.OBJECT_CLEANUP_FAILED).create_event(params.key,
                                        { bucket_path: this.bucket_path, object_name: params.key }, err);
                dbg.warn('NamespaceFS: read_object_stream buffer pool cleanup error', err);
            }
        }
    }


    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        const fs_context = this.prepare_fs_context(object_sdk);
        await this._load_bucket(params, fs_context);
        await this._throw_if_low_space(fs_context, params.size);
        const open_mode = native_fs_utils._is_gpfs(fs_context) ? 'wt' : 'w';
        const file_path = this._get_file_path(params);
        let upload_params;
        try {
            await this._check_path_in_bucket_boundaries(fs_context, file_path);

            if (this.empty_dir_content_flow(file_path, params)) {
                const content_dir_info = await this._create_empty_dir_content(fs_context, params, file_path);
                return content_dir_info;
            }

            await this._throw_if_storage_class_not_supported(params.storage_class);

            upload_params = await this._start_upload(fs_context, object_sdk, file_path, params, open_mode);

            if (!params.copy_source || upload_params.copy_res === copy_status_enum.FALLBACK) {
                // We are taking the buffer size closest to the sized upload
                const bp = multi_buffer_pool.get_buffers_pool(params.size);
                const upload_res = await bp.sem.surround_count(
                    bp.buf_size, async () => this._upload_stream(upload_params));
                upload_params.digest = upload_res.digest;
            }

            const upload_info = await this._finish_upload(upload_params);
            return upload_info;
        } catch (err) {
            this.run_update_issues_report(object_sdk, err);
            //filed to put object
            new NoobaaEvent(NoobaaEvent.OBJECT_UPLOAD_FAILED).create_event(params.key,
                {bucket_path: this.bucket_path, object_name: params.key}, err);
            dbg.warn('NamespaceFS: upload_object buffer pool cleanup error', err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        } finally {
            try {
                if (upload_params && upload_params.target_file) await upload_params.target_file.close(fs_context);
            } catch (err) {
                dbg.warn('NamespaceFS: upload_object file close error', err);
            }
        }
    }

    // creates upload_path if needed
    // on copy will call try_copy_file() or fallback
    // and opens upload_path (if exists) or file_path
    // returns upload params - params that are passed to the called functions in upload_object
    async _start_upload(fs_context, object_sdk, file_path, params, open_mode) {
        const force_copy_fallback = await this._check_copy_storage_class(fs_context, params);

        let upload_path;
        // upload path is needed only when open_mode is w / for copy
        if (open_mode === 'w' || params.copy_source) {
            const upload_id = uuidv4();
            const bucket_tmp_dir_path = this.get_bucket_tmpdir_full_path();
            upload_path = path.join(bucket_tmp_dir_path, 'uploads', upload_id);
            await native_fs_utils._make_path_dirs(upload_path, fs_context);
        }
        let open_path = upload_path || file_path;

        let copy_res;
        if (force_copy_fallback) {
            copy_res = copy_status_enum.FALLBACK;
        } else if (params.copy_source) {
            copy_res = await this._try_copy_file(fs_context, params, file_path, upload_path);
        }

        if (copy_res) {
            if (copy_res === copy_status_enum.FALLBACK) {
                params.copy_source.nsfs_copy_fallback();
            } else {
                // open file after copy link/same inode should use read open mode
                open_mode = config.NSFS_OPEN_READ_MODE;
                if (copy_res === copy_status_enum.SAME_INODE) open_path = file_path;
            }
        }
        const target_file = await native_fs_utils.open_file(fs_context, this.bucket_path, open_path, open_mode);
        return { fs_context, params, object_sdk, open_mode, file_path, upload_path, target_file, copy_res };
    }


    // on server side copy -
    // 1. check if source and target is same inode and return if do nothing if true, status is SAME_INODE
    // 2. else we try link - on link success, status is LINKED
    // 3. if link failed - status is fallback - read the stream from the source and upload it as regular upload
    // on non server side copy - we will immediatly do the fallback
    async _try_copy_file(fs_context, params, file_path, upload_path) {
        const source_file_path = await this._find_version_path(fs_context, params.copy_source);
        await this._check_path_in_bucket_boundaries(fs_context, source_file_path);
        // await this._fail_if_archived_or_sparse_file(fs_context, source_file_path, stat);
        let res = copy_status_enum.FALLBACK;
        if (this._is_versioning_disabled()) {
            try {
                // indicates a retry situation in which the source and target point to the same inode
                const same_inode = await this._is_same_inode(fs_context, source_file_path, file_path);
                if (same_inode) return copy_status_enum.SAME_INODE;
                // Doing a hard link.
                await nb_native().fs.link(fs_context, source_file_path, upload_path);
                res = copy_status_enum.LINKED;
            } catch (e) {
                dbg.warn('NamespaceFS: COPY using link failed with:', e);
            }
        }
        return res;
    }

    /**
     * _check_copy_storage_class returns true if a copy is needed to be forced.
     * 
     * This might be needed if we need to manage xattr separately on the source
     * object and target object (eg. GLACIER objects).
     * 
     * NOTE: The function will throw S3 error if source object storage class is
     * "GLACIER" but it is not in restored state (AWS behaviour).
     * @param {nb.NativeFSContext} fs_context 
     * @param {Record<any, any>} params 
     * @returns {Promise<boolean>}
     */
    async _check_copy_storage_class(fs_context, params) {
        if (params.copy_source) {
            const src_file_path = await this._find_version_path(fs_context, params.copy_source);
            const stat = await nb_native().fs.stat(fs_context, src_file_path);
            const src_storage_class = s3_utils.parse_storage_class(stat.xattr[XATTR_STORAGE_CLASS_KEY]);
            const src_restore_status = GlacierBackend.get_restore_status(stat.xattr, new Date(), src_file_path);

            if (src_storage_class === s3_utils.STORAGE_CLASS_GLACIER) {
                if (src_restore_status?.ongoing || !src_restore_status?.expiry_time) {
                    dbg.warn('_validate_upload: object is not restored yet', src_restore_status);
                    throw new S3Error(S3Error.InvalidObjectState);
                }

                return true;
            }
        }

        return params.copy_source && params.storage_class === s3_utils.STORAGE_CLASS_GLACIER;
    }

    // on put part - file path is equal to upload path
    // put part upload should NOT contain -  versioning & move to dest steps
    // if copy status is SAME_INODE - NO xattr replace/move_to_dest
    // if copy status is LINKED - NO xattr replace
    // xattr_copy = false implies on non server side copy fallback copy (copy status = FALLBACK)
    // target file can be undefined when it's a folder created and size is 0
    async _finish_upload({ fs_context, params, open_mode, target_file, upload_path, file_path, digest = undefined,
            copy_res = undefined, offset }) {
        const part_upload = file_path === upload_path;
        const same_inode = params.copy_source && copy_res === copy_status_enum.SAME_INODE;
        const is_dir_content = this._is_directory_content(file_path, params.key);

        let stat = await target_file.stat(fs_context);
        this._verify_encryption(params.encryption, this._get_encryption_info(stat));

        // handle xattr
        // assign user xattr on non copy / copy with xattr_copy header provided
        const copy_xattr = params.copy_source && params.xattr_copy;
        let fs_xattr = copy_xattr ? undefined : to_fs_xattr(params.xattr);

        // assign noobaa internal xattr - content type, md5, versioning xattr
        if (params.content_type) {
            fs_xattr = fs_xattr || {};
            fs_xattr[XATTR_CONTENT_TYPE] = params.content_type;
        }
        if (digest) {
            const { md5_b64, key, bucket, upload_id } = params;
            if (md5_b64) {
                const md5_hex = Buffer.from(md5_b64, 'base64').toString('hex');
                if (md5_hex !== digest) throw new Error('_upload_stream mismatch etag: ' + util.inspect({ key, bucket, upload_id, md5_hex, digest }));
            }
            fs_xattr = this._assign_md5_to_fs_xattr(digest, fs_xattr);
        }
        if (part_upload) {
            fs_xattr = await this._assign_part_props_to_fs_xattr(fs_context, params.size, digest, offset, fs_xattr);
        }
        if (!part_upload && (this._is_versioning_enabled() || this._is_versioning_suspended())) {
            const cur_ver_info = await this._get_version_info(fs_context, file_path);
            fs_xattr = await this._assign_versions_to_fs_xattr(fs_context, cur_ver_info, stat, params.key, fs_xattr);
        }
        if (!part_upload && params.storage_class) {
            fs_xattr = Object.assign(fs_xattr || {}, {
                [XATTR_STORAGE_CLASS_KEY]: params.storage_class
            });

            if (params.storage_class === s3_utils.STORAGE_CLASS_GLACIER) {
                await this.append_to_migrate_wal(file_path);
            }
        }
        if (fs_xattr && !is_dir_content) await target_file.replacexattr(fs_context, fs_xattr);
        // fsync
        if (config.NSFS_TRIGGER_FSYNC) await target_file.fsync(fs_context);
        dbg.log1('NamespaceFS._finish_upload:', open_mode, file_path, upload_path, fs_xattr);

        if (!same_inode && !part_upload) {
            await this._move_to_dest(fs_context, upload_path, file_path, target_file, open_mode, params.key);
            if (config.NSFS_TRIGGER_FSYNC) await nb_native().fs.fsync(fs_context, path.dirname(file_path));
        }

        // when object is a dir, xattr are set on the folder itself and the content is in .folder file
        if (is_dir_content) {
            if (params.copy_source) fs_xattr = await this._get_copy_source_xattr(params, fs_context, fs_xattr);
            await this._assign_dir_content_to_xattr(fs_context, fs_xattr, { ...params, size: stat.size }, copy_xattr);
        }
        stat = await nb_native().fs.stat(fs_context, file_path);
        const upload_info = this._get_upload_info(stat, fs_xattr && fs_xattr[XATTR_VERSION_ID]);
        return upload_info;
    }

    async _create_empty_dir_content(fs_context, params, file_path) {
        await native_fs_utils._make_path_dirs(file_path, fs_context);
        const copy_xattr = params.copy_source && params.xattr_copy;

        let fs_xattr = copy_xattr ? {} : to_fs_xattr(params.xattr) || {};
        if (params.content_type) {
            fs_xattr = fs_xattr || {};
            fs_xattr[XATTR_CONTENT_TYPE] = params.content_type;
        }
        if (params.copy_source) fs_xattr = await this._get_copy_source_xattr(params, fs_context, fs_xattr);

        await this._assign_dir_content_to_xattr(fs_context, fs_xattr, params, copy_xattr);
        // when .folder exist and it's no upload flow - .folder should be deleted if it exists
        try {
            await nb_native().fs.unlink(fs_context, file_path);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            dbg.log0(`namespace_fs._create_empty_dir_content: dir object file ${config.NSFS_FOLDER_OBJECT_NAME} was already deleted`);
        }
        const dir_path = this._get_file_md_path(params);
        const stat = await nb_native().fs.stat(fs_context, dir_path);
        const upload_info = this._get_upload_info(stat, fs_xattr[XATTR_VERSION_ID]);
        return upload_info;
    }

    async _get_copy_source_xattr(params, fs_context, fs_xattr) {
        const is_source_dir = params.copy_source.key.endsWith('/');
        const source_file_md_path = await this._find_version_path(fs_context, params.copy_source, is_source_dir);
        const source_stat = await nb_native().fs.stat(fs_context, source_file_md_path);
        return { ...source_stat.xattr, ...fs_xattr };
    }

    // move to dest GPFS (wt) / POSIX (w / undefined) - non part upload
    async _move_to_dest(fs_context, source_path, dest_path, target_file, open_mode, key) {
        let retries = config.NSFS_RENAME_RETRIES;
        // will retry renaming a file in case of parallel deleting of the destination path
        for (;;) {
            try {
                await native_fs_utils._make_path_dirs(dest_path, fs_context);
                if (this._is_versioning_disabled()) {
                    if (open_mode === 'wt') {
                        await target_file.linkfileat(fs_context, dest_path);
                    } else {
                        await nb_native().fs.rename(fs_context, source_path, dest_path);
                    }
                } else {
                    await this._move_to_dest_version(fs_context, source_path, dest_path, target_file, key, open_mode);
                }
                break;
            } catch (err) {
                retries -= 1;
                if (retries <= 0) throw err;
                if (err.code !== 'ENOENT') throw err;
                // checking that the source_path still exists
                // TODO: handle tmp file - source_path is missing
                if (source_path && !await this.check_access(fs_context, source_path)) throw err;
                dbg.warn(`NamespaceFS: Retrying failed move to dest retries=${retries}` +
                    ` source_path=${source_path} dest_path=${dest_path}`, err);
            }
        }
    }

    // 1. get latest version_id
    // 2. if versioning is suspended - 
    //     2.1 if version ID of the latest version is null - 
    //       2.1.1 remove latest version
    //     2.2 else (version ID of the latest version is unique or there is no latest version) -
    //       2.2.1 remove a version (or delete marker) with null version ID from .versions/ (if exists)
    //  3. if latest version exists -
    //     versioning is enabled
    //     OR
    //     versioning is suspended AND latest version is a unique id (not null version)
    //       3.2 create .versions/ if it doesn't exist
    //       3.3 move latest version to .versions/
    // 4. move new version to latest_ver_path (key path)
    // retry safe linking a file in case of parallel put/delete of the source path
    async _move_to_dest_version(fs_context, new_ver_tmp_path, latest_ver_path, upload_file, key, open_mode) {
        dbg.log1('Namespace_fs._move_to_dest_version:', new_ver_tmp_path, latest_ver_path, upload_file);
        let gpfs_options;
        const is_gpfs = native_fs_utils._is_gpfs(fs_context);
        let retries = config.NSFS_RENAME_RETRIES;
        for (;;) {
            try {
                const new_ver_info = !is_gpfs && await this._get_version_info(fs_context, new_ver_tmp_path);
                // get latest version_id if exists
                const latest_ver_info = await this._get_version_info(fs_context, latest_ver_path);
                const versioned_path = latest_ver_info && this._get_version_path(key, latest_ver_info.version_id_str);
                const versioned_info = latest_ver_info && await this._get_version_info(fs_context, versioned_path);

                gpfs_options = is_gpfs ?
                    await this._open_files_gpfs(fs_context, new_ver_tmp_path, latest_ver_path, upload_file,
                        latest_ver_info, open_mode, undefined, versioned_info) :
                    undefined;
                const bucket_tmp_dir_path = this.get_bucket_tmpdir_full_path();
                dbg.log1('Namespace_fs._move_to_dest_version:', latest_ver_info, new_ver_info, gpfs_options);

                if (this._is_versioning_suspended()) {
                    if (latest_ver_info?.version_id_str === NULL_VERSION_ID) {
                        dbg.log1('NamespaceFS._move_to_dest_version suspended: version ID of the latest version is null - the file will be unlinked');
                        await native_fs_utils.safe_unlink(fs_context, latest_ver_path, latest_ver_info, gpfs_options, bucket_tmp_dir_path);
                    } else {
                        // remove a version (or delete marker) with null version ID from .versions/ (if exists)
                        await this._delete_null_version_from_versions_directory(key, fs_context);
                    }
                }
                if (latest_ver_info &&
                    ((this._is_versioning_enabled()) ||
                        (this._is_versioning_suspended() && latest_ver_info.version_id_str !== NULL_VERSION_ID))) {
                    dbg.log1('NamespaceFS._move_to_dest_version version ID of the latest version is a unique ID - the file will be moved it to .versions/ directory');
                    await native_fs_utils._make_path_dirs(versioned_path, fs_context);
                    await native_fs_utils.safe_move(fs_context, latest_ver_path, versioned_path, latest_ver_info,
                        gpfs_options && gpfs_options.move_to_versions, bucket_tmp_dir_path);
                }
                try {
                    // move new version to latest_ver_path (key path)
                    await native_fs_utils.safe_move(fs_context, new_ver_tmp_path, latest_ver_path, new_ver_info,
                        gpfs_options && gpfs_options.move_to_dst, bucket_tmp_dir_path);
                } catch (err) {
                    if (err.message !== native_fs_utils.posix_unlink_retry_err &&
                        err.code !== native_fs_utils.gpfs_unlink_retry_catch) throw err;
                    dbg.warn('Namespace_fs._move_to_dest_version: unable to delete new version tmp file, ignoring...');
                }
                break;
            } catch (err) {
                retries -= 1;
                if (retries <= 0 || !native_fs_utils.should_retry_link_unlink(is_gpfs, err)) throw err;
                dbg.warn(`NamespaceFS._move_to_dest_version retrying retries=${retries}` +
                    ` new_ver_tmp_path=${new_ver_tmp_path} latest_ver_path=${latest_ver_path}`, err);
            } finally {
                if (gpfs_options) await this._close_files_gpfs(fs_context, gpfs_options.move_to_dst, open_mode);
            }
        }
    }

    // Comparing both device and inode number (st_dev and st_ino returned by stat)
    // will tell you whether two different file names refer to the same thing.
    // If so, we will return the etag and encryption info of the file_path
    async _is_same_inode(fs_context, source_file_path, file_path) {
        try {
            dbg.log2('NamespaceFS: checking _is_same_inode');
            const file_path_stat = await nb_native().fs.stat(fs_context, file_path);
            const file_path_inode = file_path_stat.ino.toString();
            const file_path_device = file_path_stat.dev.toString();
            const source_file_stat = await nb_native().fs.stat(fs_context, source_file_path, { skip_user_xattr: true });
            const source_file_inode = source_file_stat.ino.toString();
            const source_file_device = source_file_stat.dev.toString();
            dbg.log2('NamespaceFS: file_path_inode:', file_path_inode, 'source_file_inode:', source_file_inode,
                'file_path_device:', file_path_device, 'source_file_device:', source_file_device);
            if (file_path_inode === source_file_inode && file_path_device === source_file_device) {
                return file_path_stat;
            }
        } catch (e) {
            dbg.log2('NamespaceFS: _is_same_inode got an error', e);
            // If we fail for any reason, we want to return undefined. so doing nothing in this catch.
        }
    }

    // Allocated the largest semaphore size config.NSFS_BUF_SIZE_L in Semaphore but in fact we can take up more inside
    // This is due to MD5 calculation and data buffers
    // Can be finetuned further on if needed and inserting the Semaphore logic inside
    // Instead of wrapping the whole _upload_stream function (q_buffers lives outside of the data scope of the stream)
    async _upload_stream({ fs_context, params, target_file, object_sdk, offset }) {
        const { source_stream } = params;
        try {
            // Not using async iterators with ReadableStreams due to unsettled promises issues on abort/destroy
            const md5_enabled = this._is_force_md5_enabled(object_sdk);
            const chunk_fs = new ChunkFS({
                target_file,
                fs_context,
                stats: this.stats,
                namespace_resource_id: this.namespace_resource_id,
                md5_enabled,
                offset,
                bucket: params.bucket,
                large_buf_size: multi_buffer_pool.get_buffers_pool(undefined).buf_size
            });
            chunk_fs.on('error', err1 => dbg.error('namespace_fs._upload_stream: error occured on stream ChunkFS: ', err1));
            await stream_utils.pipeline([source_stream, chunk_fs]);
            await stream_utils.wait_finished(chunk_fs);
            return { digest: chunk_fs.digest, total_bytes: chunk_fs.total_bytes };
        } catch (error) {
            dbg.error('_upload_stream had error: ', error);
            throw error;
        }
    }


    //////////////////////
    // MULTIPART UPLOAD //
    //////////////////////

    async list_uploads(params, object_sdk) {
        // TODO: Need to support pagination.
        const fs_context = this.prepare_fs_context(object_sdk);
        await this._load_bucket(params, fs_context);
        const mpu_root_path = this._mpu_root_path();
        await this._check_path_in_bucket_boundaries(fs_context, mpu_root_path);
        const multipart_upload_dirs = await nb_native().fs.readdir(fs_context, mpu_root_path);
        const common_prefixes_set = new Set();
        const multipart_uploads = await P.map(multipart_upload_dirs, async obj => {
            const create_path = path.join(mpu_root_path, obj.name, 'create_object_upload');
            const { data: create_params_buffer } = await nb_native().fs.readFile(
                fs_context,
                create_path
            );
            const create_params_parsed = JSON.parse(create_params_buffer.toString());

            // dont add keys that dont start with the prefix
            if (params.prefix && !create_params_parsed.key.startsWith(params.prefix)) {
                return undefined;
            }

            // common_prefix contains (if there are any) prefixes between the provide prefix
            // and the next occurrence of the string specified by the delimiter
            if (params.delimiter) {
                const start_idx = params.prefix ? params.prefix.length : 0;
                const delimiter_idx = create_params_parsed.key.indexOf(params.delimiter, start_idx);
                if (delimiter_idx > 0) {
                    common_prefixes_set.add(create_params_parsed.key.substring(0, delimiter_idx + 1));
                    // if key has common prefix it should not be returned as an upload object 
                    return undefined;
                }
            }
            const stat = await nb_native().fs.stat(fs_context, create_path);
            return this._get_mpu_info(create_params_parsed, stat);
        });
        return {
            objects: _.compact(multipart_uploads),
            common_prefixes: [...common_prefixes_set],
            is_truncated: false,
            next_marker: undefined,
            next_upload_id_marker: undefined,
        };
    }

    async create_object_upload(params, object_sdk) {
        try {
            const fs_context = this.prepare_fs_context(object_sdk);
            await this._load_bucket(params, fs_context);
            await this._throw_if_low_space(fs_context);
            params.obj_id = uuidv4();
            params.mpu_path = this._mpu_path(params);
            await native_fs_utils._create_path(params.mpu_path, fs_context);
            const create_params = JSON.stringify({ ...params, source_stream: null });

            await this._throw_if_storage_class_not_supported(params.storage_class);

            await nb_native().fs.writeFile(
                fs_context,
                path.join(params.mpu_path, 'create_object_upload'),
                Buffer.from(create_params), {
                    mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE),
                },
            );
            return { obj_id: params.obj_id };
        } catch (err) {
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
    }

    _get_part_data_path(params) {
        return path.join(params.mpu_path, `parts-size-${params.size}`);
    }

    _get_part_md_path(params) {
        return path.join(params.mpu_path, `part-${params.num}`);
    }

    // optimized version of upload_multipart - 
    // 1. if size is pre known -
    //    1.1. calc offset
    //    1.2. upload data to by_size file in offset position
    //    1.3. set on the part_md_file size, offset and etag xattr
    // 2. else -
    //    2.1. upload data to part_md_file
    //    2.2. calc offset
    //    2.3. copy the bytes to by_size file
    //    2.4. set on the part_md_file size, offset and etag xattr
    async upload_multipart(params, object_sdk) {
        const data_open_mode = 'w*';
        const md_open_mode = 'w+';
        const fs_context = this.prepare_fs_context(object_sdk);
        let target_file;
        let part_md_file;
        try {
            await this._load_multipart(params, fs_context);
            await this._throw_if_low_space(fs_context, params.size);

            const md_upload_path = this._get_part_md_path(params);
            part_md_file = await native_fs_utils.open_file(fs_context, this.bucket_path, md_upload_path, md_open_mode);
            let md_upload_params = {
                fs_context, params, object_sdk, upload_path: md_upload_path, open_mode: md_open_mode,
                target_file: part_md_file, file_path: md_upload_path
            };

            let upload_res;
            const pre_known_size = (params.size >= 0);
            if (!pre_known_size) {
                // 2.1
                const bp = multi_buffer_pool.get_buffers_pool(undefined);
                upload_res = await bp.sem.surround_count(bp.buf_size,
                    async () => this._upload_stream(md_upload_params));
                params.size = upload_res.total_bytes;
            }
            const offset = params.size * (params.num - 1);
            const upload_path = this._get_part_data_path(params);
            dbg.log1(`NamespaceFS: upload_multipart, data path=${upload_path} offset=${offset} data_open_mode=${data_open_mode}`);

            target_file = await native_fs_utils.open_file(fs_context, this.bucket_path, upload_path, data_open_mode);
            const data_upload_params = {
                fs_context, params, object_sdk, upload_path, data_open_mode, target_file,
                file_path: upload_path, offset
            };

            if (pre_known_size) {
                const bp = multi_buffer_pool.get_buffers_pool(params.size);
                upload_res = await bp.sem.surround_count(bp.buf_size,
                    async () => this._upload_stream(data_upload_params));
            } else {
                // 2.3 if size was not pre known, copy data from part_md_file to by_size file
                await native_fs_utils.copy_bytes(multi_buffer_pool, fs_context, part_md_file, target_file, params.size, offset, 0);
            }

            md_upload_params = { ...md_upload_params, offset, digest: upload_res.digest };
            const upload_info = await this._finish_upload(md_upload_params);
            return upload_info;
        } catch (err) {
            this.run_update_issues_report(object_sdk, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        } finally {
            await native_fs_utils.finally_close_files(fs_context, [target_file, part_md_file]);
        }
    }


    async list_multiparts(params, object_sdk) {
        try {
            const fs_context = this.prepare_fs_context(object_sdk);
            await this._load_multipart(params, fs_context);
            await this._check_path_in_bucket_boundaries(fs_context, params.mpu_path);
            const { data } = await nb_native().fs.readFile(
                fs_context,
                path.join(params.mpu_path, 'create_object_upload')
            );
            const create_multipart_upload_params = JSON.parse(data.toString());
            const entries = await nb_native().fs.readdir(fs_context, params.mpu_path);
            const multiparts = await Promise.all(
                entries
                .filter(e => e.name.startsWith('part-'))
                .map(async e => {
                    const num = Number(e.name.slice('part-'.length));
                    const part_path = path.join(params.mpu_path, e.name);
                    const stat = await nb_native().fs.stat(fs_context, part_path);
                    return {
                        num,
                        size: stat.size,
                        etag: this._get_etag(stat),
                        last_modified: new Date(stat.mtime),
                    };
                })
            );
            return {
                is_truncated: false,
                next_num_marker: undefined,
                multiparts,
                storage_class: create_multipart_upload_params.storage_class
            };
        } catch (err) {
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
    }

    // iterate over multiparts array - 
    // 1. if num of unique sizes is 1
    //    1.1. if this is the last part - link the size file and break the loop
    //    1.2. else, continue the loop
    // 2. if num of unique sizes is 2
    //    2.1. if should_copy_file_prefix
    //         2.1.1. if the cur part is the last, link the previous part file to upload_path and copy the last part (tail) to upload_path  
    //         2.1.2. else - copy the prev part size file prefix to upload_path
    // 3. copy bytes of the current's part size file
    async complete_object_upload(params, object_sdk) {
        const part_size_to_fd_map = new Map(); // { size: fd }
        let read_file;
        let target_file;
        const fs_context = this.prepare_fs_context(object_sdk);
        await this._throw_if_low_space(fs_context);
        const open_mode = 'w*';
        try {
            const md5_enabled = this._is_force_md5_enabled(object_sdk);
            const MD5Async = md5_enabled ? new (nb_native().crypto.MD5Async)() : undefined;
            const { multiparts = [] } = params;
            multiparts.sort((a, b) => a.num - b.num);
            await this._load_multipart(params, fs_context);
            const file_path = this._get_file_path(params);

            await this._check_path_in_bucket_boundaries(fs_context, file_path);
            const upload_path = path.join(params.mpu_path, 'final');

            target_file = null;
            let prev_part_size = 0;
            let should_copy_file_prefix = true;
            let total_size = 0;
            for (const { num, etag } of multiparts) {
                const md_part_path = this._get_part_md_path({ ...params, num });
                const md_part_stat = await nb_native().fs.stat(fs_context, md_part_path);
                const part_size = Number(md_part_stat.xattr[XATTR_PART_SIZE]);
                const part_offset = Number(md_part_stat.xattr[XATTR_PART_OFFSET]);
                if (etag !== this._get_etag(md_part_stat)) {
                    throw new Error('mismatch part etag: ' + util.inspect({ num, etag, md_part_path, md_part_stat, params }));
                }
                if (MD5Async) await MD5Async.update(Buffer.from(etag, 'hex'));

                const data_part_path = this._get_part_data_path({ ...params, size: part_size });
                if (part_size_to_fd_map.has(part_size)) {
                    read_file = part_size_to_fd_map.get(part_size);
                } else {
                    read_file = await native_fs_utils.open_file(fs_context, this.bucket_path, data_part_path, config.NSFS_OPEN_READ_MODE);
                    part_size_to_fd_map.set(part_size, read_file);
                }

                // 1
                if (part_size_to_fd_map.size === 1) {
                    if (num === multiparts.length) {
                        await nb_native().fs.link(fs_context, data_part_path, upload_path);
                        break;
                    } else {
                        prev_part_size = part_size;
                        total_size += part_size;
                        continue;
                    }
                } else if (part_size_to_fd_map.size === 2 && should_copy_file_prefix) { // 2
                    if (num === multiparts.length) {
                        const prev_data_part_path = this._get_part_data_path({ ...params, size: prev_part_size });
                        await nb_native().fs.link(fs_context, prev_data_part_path, upload_path);
                    } else {
                        const prev_read_file = part_size_to_fd_map.get(prev_part_size);
                        if (!target_file) {
                            target_file = await native_fs_utils.open_file(fs_context, this.bucket_path, upload_path, open_mode);
                        }
                        // copy (num - 1) parts, all the same size of the prev part
                        const copy_size = prev_part_size * (num - 1);
                        await native_fs_utils.copy_bytes(multi_buffer_pool, fs_context, prev_read_file, target_file, copy_size, 0, 0);
                    }
                    should_copy_file_prefix = false;
                }
                // 3
                if (!target_file) target_file = await native_fs_utils.open_file(fs_context, this.bucket_path, upload_path, open_mode);
                await native_fs_utils.copy_bytes(multi_buffer_pool, fs_context, read_file, target_file, part_size, total_size, part_offset);
                prev_part_size = part_size;
                total_size += part_size;
            }
            if (!target_file) target_file = await native_fs_utils.open_file(fs_context, this.bucket_path, upload_path, open_mode);

            const { data: create_params_buffer } = await nb_native().fs.readFile(
                fs_context,
                path.join(params.mpu_path, 'create_object_upload')
            );

            const upload_params = { fs_context, upload_path, open_mode, file_path, params, target_file };
            const create_params_parsed = JSON.parse(create_params_buffer.toString());
            upload_params.params.xattr = create_params_parsed.xattr;
            upload_params.params.storage_class = create_params_parsed.storage_class;
            upload_params.digest = MD5Async && (((await MD5Async.digest()).toString('hex')) + '-' + multiparts.length);

            const upload_info = await this._finish_upload(upload_params);

            await target_file.close(fs_context);
            target_file = null;
            if (config.NSFS_REMOVE_PARTS_ON_COMPLETE) await native_fs_utils.folder_delete(params.mpu_path, fs_context);
            return upload_info;
        } catch (err) {
            dbg.error(err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        } finally {
            await this.complete_object_upload_finally(undefined, [...part_size_to_fd_map.values()], target_file, fs_context);
        }
    }


    // complete_object_upload method has too many statements
    async complete_object_upload_finally(buffer_pool_cleanup, read_file_arr, write_file, fs_context) {
        try {
            // release buffer back to pool if needed
            if (buffer_pool_cleanup) buffer_pool_cleanup();
        } catch (err) {
            dbg.warn('NamespaceFS: complete_object_upload buffer pool cleanup error', err);
        }
        await native_fs_utils.finally_close_files(fs_context, read_file_arr);
        try {
            if (write_file) await write_file.close(fs_context);
        } catch (err) {
            dbg.warn('NamespaceFS: complete_object_upload write file close error', err);
        }
    }

    async abort_object_upload(params, object_sdk) {
        const fs_context = this.prepare_fs_context(object_sdk);
        await this._load_multipart(params, fs_context);
        dbg.log0('NamespaceFS: abort_object_upload', params.mpu_path);
        await native_fs_utils.folder_delete(params.mpu_path, fs_context);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        try {
            const fs_context = this.prepare_fs_context(object_sdk);
            await this._load_bucket(params, fs_context);
            const file_path = await this._find_version_path(fs_context, params);
            await this._check_path_in_bucket_boundaries(fs_context, file_path);
            dbg.log0('NamespaceFS: delete_object', file_path);
            let res;
            if (this._is_versioning_disabled()) {
                await this._delete_single_object(fs_context, file_path, params);
            } else {
                res = params.version_id ?
                    await this._delete_version_id(fs_context, file_path, params) :
                    await this._delete_latest_version(fs_context, file_path, params);
            }
            return res || {};
        } catch (err) {
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
    }


    async delete_multiple_objects(params, object_sdk) {
        try {
            const fs_context = this.prepare_fs_context(object_sdk);
            await this._load_bucket(params, fs_context);
            let res = [];
            if (this._is_versioning_disabled()) {
                for (const { key, version } of params.objects) {
                    if (version) {
                        res.push({});
                        continue;
                    }
                    try {
                        const file_path = this._get_file_path({ key });
                        await this._check_path_in_bucket_boundaries(fs_context, file_path);
                        dbg.log1('NamespaceFS: delete_multiple_objects', file_path);
                        await this._delete_single_object(fs_context, file_path, { key });
                        res.push({ key });
                    } catch (err) {
                        res.push({ err_code: err.code, err_message: err.message });
                    }
                }
            } else {
                // [{key: a, version: 1}, {key: a, version: 2}, {key:b, version: 1}] => {'a': [1, 2], 'b': [1]}
                const versions_by_key_map = {};
                for (const { key, version_id } of params.objects) {
                    if (versions_by_key_map[key]) versions_by_key_map[key].push(version_id);
                    else versions_by_key_map[key] = [version_id];
                }
                dbg.log3('NamespaceFS: versions_by_key_map', versions_by_key_map);
                for (const key of Object.keys(versions_by_key_map)) {
                    const key_res = await this._delete_objects_versioned(fs_context, key, versions_by_key_map[key]);
                    res = res.concat(key_res);
                }
            }
            return res;
        } catch (err) {
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
    }


    async _delete_single_object(fs_context, file_path, params) {
        try {
            await nb_native().fs.unlink(fs_context, file_path);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
        await this._delete_path_dirs(file_path, fs_context);
        // when deleting the data of a directory object, we need to remove the directory dir object xattr
        // if the dir still exists - occurs when deleting dir while the dir still has entries in it
        if (this._is_directory_content(file_path, params.key)) {
            await this._clear_user_xattr(fs_context, this._get_file_md_path(params), XATTR_USER_PREFIX);
        }
    }

    ///////////////////////
    // OBJECT VERSIONING //
    ///////////////////////

    async set_bucket_versioning(versioning, object_sdk) {
        if (!config.NSFS_VERSIONING_ENABLED) throw new RpcError('BAD_REQUEST', 'nsfs versioning is unsupported');
        try {
            const fs_context = this.prepare_fs_context(object_sdk);
            await nb_native().fs.checkAccess(fs_context, this.bucket_path);
            this.versioning = versioning;
        } catch (err) {
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.BUCKET);
        }
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async get_object_tagging(params, object_sdk) {
        const tag_set = [];
        let file_path;
        if (params.version_id && this._is_versioning_enabled()) {
            file_path = this._get_version_path(params.key, params.version_id);
        } else {
            file_path = this._get_file_path(params);
        }
        try {
            const fs_context = this.prepare_fs_context(object_sdk);
            dbg.log0('NamespaceFS.get_object_tagging: param ', params, 'file_path :', file_path);
            const file = await nb_native().fs.open(fs_context, file_path);
            const stat = await file.stat(fs_context);
            if (stat.xattr) {
                for (const [xattr_key, xattr_value] of Object.entries(stat.xattr)) {
                    if (xattr_key.includes(XATTR_NOOBAA_CUSTOM_PREFIX)) {
                        tag_set.push({
                            key: xattr_key.replace(XATTR_NOOBAA_CUSTOM_PREFIX, ''),
                            value: xattr_value,
                        });
                    }
                }
            }
        } catch (err) {
            dbg.error(`NamespaceFS.get_object_tagging: failed in dir ${file_path} with error: `, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
        dbg.log0('NamespaceFS.get_object_tagging: return tagging ', tag_set, 'file_path :', file_path);
        return { tagging: tag_set };
    }

    async delete_object_tagging(params, object_sdk) {
        dbg.log0('NamespaceFS.delete_object_tagging:', params);
        let file_path;
        if (params.version_id && this._is_versioning_enabled()) {
            file_path = this._get_version_path(params.key, params.version_id);
        } else {
            file_path = this._get_file_path(params);
        }
        const fs_context = this.prepare_fs_context(object_sdk);
        try {
            await this._clear_user_xattr(fs_context, file_path, XATTR_NOOBAA_CUSTOM_PREFIX);
        } catch (err) {
            dbg.error(`NamespaceFS.delete_object_tagging: failed in dir ${file_path} with error: `, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
        return {version_id: params.version_id};
    }

    async put_object_tagging(params, object_sdk) {
        const fs_xattr = {};
        const tagging = params.tagging && Object.fromEntries(params.tagging.map(tag => ([tag.key, tag.value])));
        for (const [xattr_key, xattr_value] of Object.entries(tagging)) {
              fs_xattr[XATTR_NOOBAA_CUSTOM_PREFIX + xattr_key] = xattr_value;
        }
        const file_path = this._get_file_path(params);
        const fs_context = this.prepare_fs_context(object_sdk);
        dbg.log0('NamespaceFS.put_object_tagging: fs_xattr ', fs_xattr, 'file_path :', file_path);
        try {
            // remove existng tag before putting new tags
            await this._clear_user_xattr(fs_context, file_path, XATTR_NOOBAA_CUSTOM_PREFIX);
            await this.set_fs_xattr_op(fs_context, file_path, fs_xattr, undefined);
        } catch (err) {
            dbg.error(`NamespaceFS.put_object_tagging: failed in dir ${file_path} with error: `, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.OBJECT);
        }
        return { tagging: [], version_id: params.version_id };
    }

    //////////////////////////
    // AZURE BLOB MULTIPART //
    //////////////////////////

    async upload_blob_block(params, object_sdk) {
        throw new Error('TODO');
    }
    async commit_blob_block_list(params, object_sdk) {
        throw new Error('TODO');
    }
    async get_blob_block_lists(params, object_sdk) {
        throw new Error('TODO');
    }

    //////////
    // ACLs //
    //////////
    /*
    NooBaa does not support ACLs - not for buckets, nor objects.
    However, some S3 clients fail to function entirely without a valid response to execution of ACL operations.
    Thus, we opted to implement a faux-support for the operation - enough to allow the clients to work, but still without supporting ACLs.
    The reason that read_object_md() is used, is to allow potential errors to rise up if necessary -
    for example, if the user tries to interact with an object that does not exist, the operation would fail as expected with NoSuchObject.
    */
    async get_object_acl(params, object_sdk) {
        await this.read_object_md(params, object_sdk);
        return s3_utils.DEFAULT_OBJECT_ACL;
    }

    async put_object_acl(params, object_sdk) {
        await this.read_object_md(params, object_sdk);
    }

    ///////////////////
    //  OBJECT LOCK  //
    ///////////////////

    async get_object_legal_hold() {
        throw new Error('TODO');
    }
    async put_object_legal_hold() {
        throw new Error('TODO');
    }
    async get_object_retention() {
        throw new Error('TODO');
    }
    async put_object_retention() {
        throw new Error('TODO');
    }

    ////////////////////
    // OBJECT RESTORE //
    ////////////////////

    /**
     * restore_object simply sets the restore request xattr
     * which should be picked by another mechanism.
     * 
     * restore_object internally relies on 2 xattrs:
     * - XATTR_RESTORE_REQUEST
     * - XATTR_RESTORE_EXPIRY
     * @param {*} params 
     * @param {nb.ObjectSDK} object_sdk 
     * @returns {Promise<boolean>}
     */
    async restore_object(params, object_sdk) {
        dbg.log0('namespace_fs.restore_object:', params);

        await this._throw_if_storage_class_not_supported(s3_utils.STORAGE_CLASS_GLACIER);

        const fs_context = this.prepare_fs_context(object_sdk);
        const file_path = await this._find_version_path(fs_context, params, false);
        let file = null;
        try {
            file = await nb_native().fs.open(fs_context, file_path);
            const stat = await file.stat(fs_context);

            const now = new Date();
            const restore_status = GlacierBackend.get_restore_status(stat.xattr, now, file_path);
            dbg.log1(
                'namespace_fs.restore_object:', file_path,
                'restore_status:', restore_status,
            );

            if (!restore_status) {
                // The function returns undefined only when the storage class isn't glacier
                throw new S3Error(S3Error.InvalidObjectStorageClass);
            }

            if (restore_status.state === GlacierBackend.RESTORE_STATUS_CAN_RESTORE) {
                // First add it to the log and then add the extended attribute as if we fail after
                // this point then the restore request can be triggered again without issue but
                // the reverse doesn't works.
                await this.append_to_restore_wal(file_path);

                await file.replacexattr(fs_context, {
                    [GlacierBackend.XATTR_RESTORE_REQUEST]: params.days.toString(),
                });

                // Should result in HTTP: 202 Accepted
                return true;
            }

            if (restore_status.state === GlacierBackend.RESTORE_STATUS_ONGOING) {
                throw new S3Error(S3Error.RestoreAlreadyInProgress);
            }

            if (restore_status.state === GlacierBackend.RESTORE_STATUS_RESTORED) {
                const expires_on = GlacierBackend.generate_expiry(
                    now,
                    params.days,
                    config.NSFS_GLACIER_EXPIRY_TIME_OF_DAY,
                    config.NSFS_GLACIER_EXPIRY_TZ,
                );

                await file.replacexattr(fs_context, {
                    [GlacierBackend.XATTR_RESTORE_EXPIRY]: expires_on.toISOString(),
                });

                // Should result in HTTP: 200 OK
                return false;
            }
        } catch (error) {
            dbg.error('namespace_fs.restore_object: failed with error: ', error, file_path);
            throw native_fs_utils.translate_error_codes(error, native_fs_utils.entity_enum.OBJECT);
        } finally {
            if (file) await file.close(fs_context);
        }
    }

    ///////////////
    // INTERNALS //
    ///////////////

    _get_file_path({key}) {
        // not allowing keys with dots follow by slash which can be treated as relative paths and "leave" the bucket_path
        // We are not using `path.isAbsolute` as path like '/../..' will return true and we can still "leave" the bucket_path
        if (key.includes('./')) throw new Error('Bad relative path key ' + key);

        // using normalize to get rid of multiple slashes in the middle of the path (but allows single trailing /)
        const p = path.normalize(path.join(this.bucket_path, key));

        // when the key refers to a directory (trailing /) we append a unique entry name
        // so that we can upload/download the object content to that dir entry.
        return p.endsWith('/') ? p + config.NSFS_FOLDER_OBJECT_NAME : p;
    }

    _get_file_md_path({ key }) {
        const p = this._get_file_path({ key });
        // when the key refers to a directory (trailing /) but we would like to return the md path
        // we return the parent directory of .folder
        return this._is_directory_content(p, key) ? path.join(path.dirname(p), '/') : p;
    }

    _assign_md5_to_fs_xattr(md5_digest, fs_xattr) {
        // TODO: Assign content_md5_mtime
        fs_xattr = Object.assign(fs_xattr || {}, {
            [XATTR_MD5_KEY]: md5_digest
        });
        return fs_xattr;
    }

    async _assign_versions_to_fs_xattr(fs_context, prev_ver_info, new_ver_stat, key, fs_xattr, delete_marker) {
        if (!prev_ver_info) prev_ver_info = await this.find_max_version_past(fs_context, key);

        fs_xattr = Object.assign(fs_xattr || {}, {
            [XATTR_VERSION_ID]: this._get_version_id_by_mode(new_ver_stat)
        });

        if (prev_ver_info) fs_xattr[XATTR_PREV_VERSION_ID] = prev_ver_info.version_id_str;
        if (delete_marker) fs_xattr[XATTR_DELETE_MARKER] = delete_marker;

        return fs_xattr;
    }

    async _assign_part_props_to_fs_xattr(fs_context, size, digest, offset, fs_xattr) {
        fs_xattr = Object.assign(fs_xattr || {}, {
            [XATTR_PART_SIZE]: size,
            [XATTR_PART_OFFSET]: offset,
            [XATTR_PART_ETAG]: digest

        });
        return fs_xattr;
    }

    /**
     * 
     * @param {*} fs_context - fs context object
     * @param {string} file_path - path to file
     * @param {*} set - the xattr object to be set
     * @param {*} clear - the xattr prefix to be cleared
     * @returns {Promise<void>}
     */
    async set_fs_xattr_op(fs_context, file_path, set, clear) {
        let file;
        try {
            file = await nb_native().fs.open(fs_context, file_path, config.NSFS_OPEN_READ_MODE,
                native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE));
            await file.replacexattr(fs_context, set, clear);
            await file.close(fs_context);
            file = null;
        } catch (error) {
            dbg.error('NamespaceFS.handle_fs_xattr_op: failed with error: ', error, file_path);
            throw native_fs_utils.translate_error_codes(error, native_fs_utils.entity_enum.OBJECT);
        } finally {
            if (file) await file.close(fs_context);
        }
    }

    /**
     *
     * @param {*} fs_context - fs context object
     * @param {string} file_path - file to path to be xattr cleared
     * @returns {Promise<void>}
    */
    async _clear_user_xattr(fs_context, file_path, prefix) {
        try {
            await this.set_fs_xattr_op(fs_context, file_path, undefined, prefix);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            dbg.log0(`NamespaceFS._clear_user_xattr: dir ${file_path} was already deleted`);
        }
    }

    /**
     *
     * @param {*} fs_context - fs context object
     * @param {object} fs_xattr - fs_xattr object to be set on a directory
     * @param {object} params - upload object params
     * @returns {Promise<void>}
     * assigns XATTR_DIR_CONTENT xattr to the fs_xattr object of the file and set to the directory
     * existing xattr starting with XATTR_USER_PREFIX will be cleared
    */
    async _assign_dir_content_to_xattr(fs_context, fs_xattr, params, copy_xattr) {
        const dir_path = this._get_file_md_path(params);
        fs_xattr = Object.assign(fs_xattr || {}, {
            [XATTR_DIR_CONTENT]: params.size || 0
        });
        // when copying xattr we shouldn't clear user xattr
        const clear_xattr = copy_xattr ? '' : XATTR_USER_PREFIX;
        await this.set_fs_xattr_op(fs_context, dir_path, fs_xattr, clear_xattr);
    }

    /**
     *
     * @param {string} file_path - fs context object
     * @param {string} key - fs_xattr object to be set on a directory
     * @returns {boolean} - describes if the file path describe a directory content
    */
    _is_directory_content(file_path, key) {
        return (file_path && file_path.endsWith(config.NSFS_FOLDER_OBJECT_NAME)) && (key && key.endsWith('/'));
    }

    /**
     * @param {string} dir_key
     * @param {fs.Dirent} ent
     * @returns {string}
     */
    _get_entry_key(dir_key, ent, isDir) {
        if (ent.name === config.NSFS_FOLDER_OBJECT_NAME) return dir_key;
        return dir_key + ent.name + (isDir ? '/' : '');
    }

    /**
     * @param {string} dir_key
     * @param {fs.Dirent} ent
     * @returns {string}
     */
     _get_version_entry_key(dir_key, ent) {
        if (ent.name === config.NSFS_FOLDER_OBJECT_NAME) return dir_key;
        return dir_key + HIDDEN_VERSIONS_PATH + '/' + ent.name;
    }

    /**
     * @returns {string}
     */
    _get_etag(stat) {
        const xattr_etag = this._etag_from_fs_xattr(stat.xattr);
        if (xattr_etag) return xattr_etag;
        // IMPORTANT NOTICE - we must return an etag that contains a dash!
        // because this is the criteria of S3 SDK to decide if etag represents md5
        // and perform md5 validation of the data.
        return _get_version_id_by_stat(stat);
    }

    _etag_from_fs_xattr(xattr) {
        if (_.isEmpty(xattr)) return undefined;
        return xattr[XATTR_MD5_KEY];
    }

    /**
     * @param {string} bucket 
     * @param {string} key 
     * @param {nb.NativeFSStats} stat 
     * @returns {nb.ObjectInfo}
     */
    _get_object_info(bucket, key, stat, return_version_id, isDir, is_latest = true) {
        const etag = this._get_etag(stat);
        const create_time = stat.mtime.getTime();
        const encryption = this._get_encryption_info(stat);
        const version_id = return_version_id && this._is_versioning_enabled() && this._get_version_id_by_xattr(stat);
        const delete_marker = stat.xattr?.[XATTR_DELETE_MARKER] === 'true';
        const dir_content_type = stat.xattr?.[XATTR_DIR_CONTENT] && ((Number(stat.xattr?.[XATTR_DIR_CONTENT]) > 0 && 'application/octet-stream') || 'application/x-directory');
        const content_type = stat.xattr?.[XATTR_CONTENT_TYPE] ||
            (isDir && dir_content_type) ||
            mime.getType(key) || 'application/octet-stream';
        const storage_class = s3_utils.parse_storage_class(stat.xattr?.[XATTR_STORAGE_CLASS_KEY]);
        const size = Number(stat.xattr?.[XATTR_DIR_CONTENT] || stat.size);

        return {
            obj_id: etag,
            bucket,
            key,
            size,
            etag,
            create_time,
            content_type,
            encryption,
            version_id,
            is_latest,
            delete_marker,
            storage_class,
            restore_status: GlacierBackend.get_restore_status(stat.xattr, new Date(), this._get_file_path({key})),
            xattr: to_xattr(stat.xattr),

            // temp:
            tag_count: 0,
            lock_settings: undefined,
            md5_b64: undefined,
            num_parts: undefined,
            sha256_b64: undefined,
            stats: undefined,
            tagging: undefined,
            object_owner: this._get_object_owner()
        };
    }

    /**
     * _get_object_owner in the future we will return object owner
     * currently not implemented because ACLs are not implemented as well
     */
    _get_object_owner() {
        return undefined;
    }

    _get_upload_info(stat, version_id) {
        const etag = this._get_etag(stat);
        const encryption = this._get_encryption_info(stat);
        return {
            etag,
            encryption,
            version_id
        };
    }

    _get_encryption_info(stat) {
        // Currently encryption is supported only on top of GPFS, otherwise we will return undefined
        return stat.xattr['gpfs.Encryption'] ? {
            algorithm: 'AES256',
            kms_key_id: '',
            context_b64: '',
            key_md5_b64: '',
            key_b64: '',
        } : undefined;
    }

    // This function verifies the user didn't ask for SSE-S3 Encryption, when Encryption is not supported by the FS
    _verify_encryption(user_encryption, fs_encryption) {
        if (user_encryption && user_encryption.algorithm === 'AES256' && !fs_encryption) {
            dbg.error('upload_object: User requested encryption but encryption not supported for FS');
            throw new RpcError('SERVER_SIDE_ENCRYPTION_CONFIGURATION_NOT_FOUND_ERROR',
                'Encryption not supported by the FileSystem');
        }
    }

    async _load_bucket(params, fs_context) {
        try {
            await nb_native().fs.stat(fs_context, this.bucket_path);
        } catch (err) {
            dbg.warn('_load_bucket failed, on bucket_path', this.bucket_path, 'got error', err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.BUCKET);
        }
    }

    _get_mpu_info(create_params, stat) {
        return {
            obj_id: create_params.obj_id,
            bucket: create_params.bucket,
            key: create_params.key,
            storage_class: create_params.storage_class,
            create_time: stat.mtime.getTime(),
            upload_started: stat.mtime.getTime(),
            content_type: create_params.content_type,
        };
    }

    _mpu_root_path() {
        return path.join(
            this.get_bucket_tmpdir_full_path(),
            'multipart-uploads');
    }

    _mpu_path(params) {
        return path.join(
            this._mpu_root_path(),
            params.obj_id
        );
    }

    async _load_multipart(params, fs_context) {
        await this._load_bucket(params, fs_context);
        params.mpu_path = this._mpu_path(params);
        try {
            await nb_native().fs.stat(fs_context, params.mpu_path);
        } catch (err) {
            // TOOD: Error handling
            if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_UPLOAD';
            throw err;
        }
    }

    async _delete_path_dirs(file_path, fs_context) {
        try {
            let dir = path.dirname(file_path);
            while (dir !== this.bucket_path) {
                await nb_native().fs.rmdir(fs_context, dir);
                dir = path.dirname(dir);
            }
        } catch (err) {
            if (err.code !== 'ENOTEMPTY' &&
                err.code !== 'ENOENT' &&
                err.code !== 'ENOTDIR' &&
                err.code !== 'EACCES'
            ) {
                dbg.log0('NamespaceFS: _delete_object_empty_path skip on unexpected error', err);
            }
        }
    }

    async create_uls(params, object_sdk) {
        const fs_context = this.prepare_fs_context(object_sdk);
        dbg.log0('NamespaceFS: create_uls fs_context:', fs_context, 'new_dir_path: ', params.full_path);
        try {
            await nb_native().fs.mkdir(fs_context, params.full_path, native_fs_utils.get_umasked_mode(0o777));
        } catch (err) {
            dbg.error('NamespaceFS: create_uls fs_context:', fs_context, 'new_dir_path: ',
                params.full_path, 'got an error:', err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.BUCKET);
        }
    }

    async delete_uls(params, object_sdk) {
        const fs_context = this.prepare_fs_context(object_sdk);
        dbg.log0('NamespaceFS: delete_uls fs_context:', fs_context, 'to_delete_dir_path: ', params.full_path);

        try {
            const list = await this.list_objects({ ...params, bucket: params.name, limit: 1 }, object_sdk);

            if (list && list.objects && list.objects.length > 0) {
                throw new RpcError('NOT_EMPTY', 'underlying directory has files in it');
            }

            await native_fs_utils.folder_delete(params.full_path, fs_context);
        } catch (err) {
            dbg.error('NamespaceFS: delete_uls fs_context:', fs_context, 'to_delete_dir_path: ',
                params.full_path, 'got an error:', err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.BUCKET);
        }
    }

    async check_access(fs_context, dir_path) {
        try {
            dbg.log0('check_access: dir_path', dir_path, 'fs_context', fs_context);
            await this._check_path_in_bucket_boundaries(fs_context, dir_path);
            await nb_native().fs.checkAccess(fs_context, dir_path);
            return true;
        } catch (err) {
            dbg.error('check_access: error ', err.code, err, dir_path, this.bucket_path);
            const is_bucket_dir = dir_path === this.bucket_path;

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

    /**
     * Return false if the entry is outside of the bucket
     * @param {*} fs_context
     * @param {*} entry_path
     * @returns
     */
    async _is_path_in_bucket_boundaries(fs_context, entry_path) {
        dbg.log1('check_bucket_boundaries: fs_context', fs_context, 'file_path', entry_path, 'this.bucket_path', this.bucket_path);
        if (!entry_path.startsWith(this.bucket_path)) {
            dbg.log0('check_bucket_boundaries: the path', entry_path, 'is not in the bucket', this.bucket_path, 'boundaries');
            return false;
        }
        try {
            // Returns the real path of the entry.
            // The entry path may point to regular file or directory, but can have symbolic links  
            const full_path = await nb_native().fs.realpath(fs_context, entry_path);
            if (!full_path.startsWith(this.bucket_path)) {
                dbg.log0('check_bucket_boundaries: the path', entry_path, 'is not in the bucket', this.bucket_path, 'boundaries');
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
                return this._is_path_in_bucket_boundaries(fs_context, path.dirname(entry_path));
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
     */
    async _check_path_in_bucket_boundaries(fs_context, entry_path) {
        if (!config.NSFS_CHECK_BUCKET_BOUNDARIES) return;
        if (!(await this._is_path_in_bucket_boundaries(fs_context, entry_path))) {
            throw error_utils.new_error_code('EACCES', 'Entry ' + entry_path + ' is not in bucket boundaries');
        }
    }

    // TODO: without fsync this logic fails also for regular files because blocks take time to update after writing.
    // async _fail_if_archived_or_sparse_file(fs_context, file_path, stat) {
    //     if (isDirectory(stat)) return;
    //     // In order to verify if the file is stored in tape we compare sizes
    //     // Multiple number of blocks by default block size and verify we get the size of the object
    //     // If we get a size that is lower than the size of the object this means that it is taped or a spare file
    //     // We had to use this logic since we do not have a POSIX call in order to verify that the file is taped
    //     // This is why sparse files won't be accessible as well
    //     if (is_sparse_file(stat)) {
    //         dbg.log0(`_fail_if_archived_or_sparse_file: ${file_path} rejected`, stat);
    //         throw new RpcError('INVALID_OBJECT_STATE', 'Attempted to access archived or sparse file');
    //     }
    // }

    // when obj is a directory and size === 0 folder content (.folder) should not be created
    empty_dir_content_flow(file_path, params) {
        const is_dir_content = this._is_directory_content(file_path, params.key);
        return is_dir_content && params.size === 0;
    }
    /**
     * returns if should force md5 calculation for the bucket/account.
     * first check if defined for bucket / account, if not use global default
     * @param {nb.ObjectSDK} object_sdk
     * @returns {boolean}
     */
    _is_force_md5_enabled(object_sdk) {
        // value defined for bucket
        if (this.force_md5_etag !== undefined) {
            return this.force_md5_etag;
        }
        // value defined for account
        if (object_sdk?.requesting_account?.force_md5_etag !== undefined) {
            return object_sdk?.requesting_account?.force_md5_etag;
        }
        // otherwise return global default
        return config.NSFS_CALCULATE_MD5;
    }

    //////////////////////////
    //// VERSIONING UTILS ////
    //////////////////////////

    _is_versioning_enabled() {
        return this.versioning === versioning_status_enum.VER_ENABLED;
    }

    _is_versioning_disabled() {
        return this.versioning === versioning_status_enum.VER_DISABLED;
    }

    _is_versioning_suspended() {
        return this.versioning === versioning_status_enum.VER_SUSPENDED;
    }

    _get_version_id_by_mode(stat) {
        if (this._is_versioning_enabled()) return _get_version_id_by_stat(stat);
        if (this._is_versioning_suspended()) return NULL_VERSION_ID;
        throw new Error('_get_version_id_by_mode: Invalid versioning mode');
    }

    // 1. if version_id_str is null version - nothing to extract
    // 2. else extract the mtime and ino or fail for invalid version_id_str
    // version_id_str - mtime-{mtimeNsBigint}-ino-{ino} | explicit null
    // returns mtimeNsBigint, ino (inode_number)
    _extract_version_info_from_xattr(version_id_str) {
        if (version_id_str === 'null') return;
        const arr = version_id_str.split('mtime-').join('').split('-ino-');
        if (arr.length < 2) throw new Error('Invalid version_id_string, cannot extract version info');
        return { mtimeNsBigint: size_utils.string_to_bigint(arr[0], 36), ino: parseInt(arr[1], 36) };
    }

    _get_version_id_by_xattr(stat) {
       return (stat && stat.xattr[XATTR_VERSION_ID]) || 'null';
    }

    // returns version path of the form bucket_path/dir/.versions/{key}_{version_id}
    _get_version_path(key, version_id) {
        const key_version = path.basename(key) + (version_id ? '_' + version_id : '');
        return path.normalize(path.join(this.bucket_path, path.dirname(key), HIDDEN_VERSIONS_PATH, key_version));
    }

    // this function returns the following version information -
    // version_id_str - mtime-{mtimeNsBigint}-ino-{ino} | explicit null
    // mtimeNsBigint - modified timestmap in bigint - last time the content of the file was modified
    // ino - refers to the data stored in a particular location
    // delete_marker - specifies if the version is a delete marker
    // prev_version_id - specifies the previous version of the wanted version
    // path - specifies the path to version
    // if version xattr contains version info - return info by xattr
    // else - it's a null version - return stat
    async _get_version_info(fs_context, version_path) {
        try {
            const stat = await nb_native().fs.stat(fs_context, version_path, { skip_user_xattr: true });
            dbg.log1('NamespaceFS._get_version_info stat ', stat, version_path);

            const version_id_str = this._get_version_id_by_xattr(stat);
            const ver_info_by_xattr = this._extract_version_info_from_xattr(version_id_str);
            return {
                ...(ver_info_by_xattr || stat),
                version_id_str,
                delete_marker: stat.xattr[XATTR_DELETE_MARKER],
                prev_version_id: stat.xattr[XATTR_PREV_VERSION_ID],
                path: version_path
            };
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            dbg.warn(`NamespaceFS._get_version_info version of ${version_path} doesn't exist`, err);
        }
        // if stat failed, undefined will return
    }

    // 1. if version exists in .versions/ folder - return its path
    // 2. else if version is latest version - return latest version path
    // 3. throw ENOENT error
    async _find_version_path(fs_context, { key, version_id }, return_md_path) {
        const cur_ver_path = return_md_path ? this._get_file_md_path({ key }) : this._get_file_path({ key });
        if (!version_id) return cur_ver_path;

        this._throw_if_wrong_version_format(version_id);
        const cur_ver_info = await this._get_version_info(fs_context, cur_ver_path);
        if (cur_ver_info && cur_ver_info.version_id_str === version_id) return cur_ver_path;

        const versioned_path = this._get_version_path(key, version_id);
        return versioned_path;
    }

    _throw_if_delete_marker(stat) {
        if (this.versioning === versioning_status_enum.VER_ENABLED || this.versioning === versioning_status_enum.VER_SUSPENDED) {
            const xattr_delete_marker = stat.xattr[XATTR_DELETE_MARKER];
            if (xattr_delete_marker) {
                throw error_utils.new_error_code('ENOENT', 'Entry is a delete marker');
            }
        }
    }

    _throw_if_wrong_version_format(version_id) {
        if (version_id === 'null') {
            return;
        }
        const v_parts = version_id.split('-');
        if (v_parts[0] !== 'mtime' || v_parts[2] !== 'ino') {
            throw new RpcError('BAD_REQUEST', 'Bad Request');
        }
        if (!version_format.test(v_parts[1]) || !version_format.test(v_parts[3])) {
            throw new RpcError('BAD_REQUEST', 'Bad Request');
        }
    }

    /**
     * @param {nb.NativeFSContext} fs_context 
     * @param {string} key 
     * @param {string} version_id 
     * @returns {Promise<{
     *   version_id_str: any;
     *   delete_marker: string;
     *   prev_version_id: string;
     *   path: any;
     *   mtimeNsBigint: bigint;
     *   ino: number;
     *   latest?: boolean;
     * }>}
     */
    // we can use this function when versioning is enabled or suspended
    async _delete_single_object_versioned(fs_context, key, version_id) {
        let retries = config.NSFS_RENAME_RETRIES;
        const is_gpfs = native_fs_utils._is_gpfs(fs_context);
        const latest_version_path = this._get_file_path({ key });
        for (;;) {
            let file_path;
            let gpfs_options;
            try {
                file_path = await this._find_version_path(fs_context, { key, version_id });
                await this._check_path_in_bucket_boundaries(fs_context, file_path);
                const version_info = await this._get_version_info(fs_context, file_path);
                if (!version_info) return;

                const deleted_latest = file_path === latest_version_path;
                if (deleted_latest) {
                    gpfs_options = is_gpfs ?
                        await this._open_files_gpfs(fs_context, file_path, undefined, undefined, undefined, undefined, true) :
                        undefined;
                    const bucket_tmp_dir_path = this.get_bucket_tmpdir_full_path();
                    await native_fs_utils.safe_unlink(fs_context, file_path, version_info, gpfs_options, bucket_tmp_dir_path);
                    return { ...version_info, latest: true };
                } else {
                    await nb_native().fs.unlink(fs_context, file_path);
                }
                return version_info;
            } catch (err) {
                retries -= 1;
                if (retries <= 0 || !native_fs_utils.should_retry_link_unlink(is_gpfs, err)) throw err;
                dbg.warn(`NamespaceFS._delete_single_object_versioned: retrying retries=${retries} file_path=${file_path}`, err);
            } finally {
                if (gpfs_options) await this._close_files_gpfs(fs_context, gpfs_options.delete_version, undefined, true);
            }
        }
    }

    // 1. iterate over the key's versions array
    //    1.1 if version_id is undefined, delete latest
    //    1.2 if version exists - unlink version
    // 2. try promote second latest to latest if one of the deleted versions is the latest version (with version id specified) or a delete marker
    async _delete_objects_versioned(fs_context, key, versions) {
        dbg.log1('NamespaceFS._delete_objects_versioned', key, versions);
        const res = [];
        let deleted_delete_marker;
        let delete_marker_created;
        let latest_ver_info;
        const latest_version_path = this._get_file_path({ key });
        await this._check_path_in_bucket_boundaries(fs_context, latest_version_path);
        for (const version_id of versions) {
            try {
                if (version_id) {
                    const del_ver_info = await this._delete_single_object_versioned(fs_context, key, version_id);
                    if (!del_ver_info) {
                        res.push({});
                        continue;
                    }
                    if (del_ver_info.latest) {
                        latest_ver_info = del_ver_info;
                    } else {
                        deleted_delete_marker = deleted_delete_marker || del_ver_info.delete_marker;
                    }
                    res.push({ deleted_delete_marker: del_ver_info.delete_marker });
                } else {
                    const version_res = await this._delete_latest_version(fs_context, latest_version_path, { key, version_id });
                    res.push(version_res);
                    delete_marker_created = true;
                }
            } catch (err) {
                res.push({ err_code: err.code, err_message: err.message });
            }
        }
        // we try promote only if the latest version was deleted or we deleted a delete marker
        // and no delete marker added (a new delete marker will be the latest - no need to promote)
        if ((latest_ver_info || deleted_delete_marker) && !delete_marker_created) {
            await this._promote_version_to_latest(fs_context, { key }, latest_ver_info, latest_version_path);
        }
        // delete .versions/ if it's empty
        const file_path = this._get_version_path(key);
        await this._delete_path_dirs(file_path, fs_context);
        return res;
    }

    // delete version_id -
    // 1. get version info, if it's empty - return
    // 2. unlink key
    // 3. if version is latest version - promote second latest -> latest
    async _delete_version_id(fs_context, file_path, params) {
        // TODO optimization - GPFS link overrides, no need to unlink before promoting, but if there is nothing to promote we should unlink
        const del_obj_version_info = await this._delete_single_object_versioned(fs_context, params.key, params.version_id);
        if (!del_obj_version_info) return {};

        // we try promote only if the latest version was deleted or we deleted a delete marker
        if (del_obj_version_info.latest || del_obj_version_info.delete_marker) {
            const latest_version_path = this._get_file_path({ key: params.key });
            await this._promote_version_to_latest(fs_context, params, del_obj_version_info, latest_version_path);
        }
        await this._delete_path_dirs(file_path, fs_context);
        return {
            deleted_delete_marker: del_obj_version_info.delete_marker,
            version_id: del_obj_version_info.version_id_str
        };
    }

    // 1. if deleted version is not latest version and not a delete marker - skip
    // 2. find max past version
    //    2.1. if max_past_version does not exist / is a delete marker - skip, nothing to move
    //    2.2. else - move max past version -> latest version path
    // 3. if deleted version mtime < max_past_version mtime - skip (check if deleted version is latest or latest delete marker in .versions/)
    // 4. move max past version -> latest version path
    // condition 2 guards on situations where we don't want to try move max version past to latest
    async _promote_version_to_latest(fs_context, params, deleted_version_info, latest_ver_path) {
        dbg.log1('Namespace_fs._promote_version_to_latest', params, deleted_version_info, latest_ver_path);
        const deleted_latest = deleted_version_info && deleted_version_info.path === latest_ver_path;
        const prev_version_id = deleted_latest && deleted_version_info.prev_version_id;

        let retries = config.NSFS_RENAME_RETRIES;
        for (;;) {
            try {
                const latest_version_info = await this._get_version_info(fs_context, latest_ver_path);
                if (latest_version_info) return;
                const max_past_ver_info = (prev_version_id &&
                    (await this.get_prev_version_info(fs_context, params.key, prev_version_id))) ||
                    (await this.find_max_version_past(fs_context, params.key));

                if (!max_past_ver_info || max_past_ver_info.delete_marker) return;
                // 2 - if deleted file is a delete marker and is older than max past version - no need to promote max - return
                if (deleted_version_info &&
                    deleted_version_info.delete_marker &&
                    deleted_version_info.mtimeNsBigint < max_past_ver_info.mtimeNsBigint) return;
                dbg.log1('Namespace_fs._promote_version_to_latest ', max_past_ver_info.path, latest_ver_path, max_past_ver_info, latest_version_info);
                // on concurrent put, safe_move_gpfs might override new coming latest (no fd verification, gpfs linkfileat will override)
                const bucket_tmp_dir_path = this.get_bucket_tmpdir_full_path();
                await native_fs_utils.safe_move_posix(fs_context, max_past_ver_info.path, latest_ver_path,
                    max_past_ver_info, bucket_tmp_dir_path);
                break;
            } catch (err) {
                retries -= 1;
                if (retries <= 0) throw err;
                if (!native_fs_utils._is_gpfs(fs_context) && err.code === 'EEXIST') {
                    dbg.warn('Namespace_fs._delete_version_id: latest version exist - skipping');
                    return;
                }
                if (err.code !== 'ENOENT') throw err;
                dbg.warn(`NamespaceFS: _promote_version_to_latest failed retries=${retries}`, err);
            }
        }
    }

    // delete latest version
    // 1. if latest version exists on the regular directory (not .versions/)
    //   1.2 if versioning is enabled OR
    //       versioning is suspended AND the latest version on the regular directory has a unique version id (not null)
    //     1.2.1 create .versions/ if it doesn't exist
    //     1.2.2 move latest version to .versions/
    //     1.2.3 if versioning is suspended AND the latest version on the regular directory has a unique version id (not null)
    //       1.2.3.1 remove latest version
    //    1.3. else (versioning is suspended AND the latest version on the regular directory is null)
    //      1.3.1 remove a version (or delete marker) with null version ID from .versions/ (if exists)
    // 2. else - latest version is a delete marker (inside .versions/) / doesn't exist - nothing to do
    //    * in case the latest version doesn't exist - we would still want to create the delete marker
    // 3. create delete marker and move it to .versions/key_{delete_marker_version_id}
    // retry safe linking a file in case of parallel put/delete of the source path
    async _delete_latest_version(fs_context, latest_ver_path, params) {
        dbg.log0('Namespace_fs._delete_latest_version:', latest_ver_path, params);

        let gpfs_options;
        const is_gpfs = native_fs_utils._is_gpfs(fs_context);
        let retries = config.NSFS_RENAME_RETRIES;
        let latest_ver_info;
        for (;;) {
            try {
                // get latest version_id if exists
                latest_ver_info = await this._get_version_info(fs_context, latest_ver_path);
                const versioned_path = latest_ver_info && this._get_version_path(params.key, latest_ver_info.version_id_str);
                const versioned_info = latest_ver_info && await this._get_version_info(fs_context, versioned_path);

                gpfs_options = is_gpfs ?
                    await this._open_files_gpfs(fs_context, latest_ver_path,
                        undefined, undefined, undefined, undefined, true, versioned_info) :
                    undefined;

                dbg.log1('Namespace_fs._delete_latest_version:', latest_ver_info, versioned_path, versioned_info, gpfs_options);
                if (latest_ver_info) {
                    const suspended_and_latest_is_not_null = this._is_versioning_suspended() &&
                        latest_ver_info.version_id_str !== NULL_VERSION_ID;
                    const bucket_tmp_dir_path = this.get_bucket_tmpdir_full_path();
                    if (this._is_versioning_enabled() || suspended_and_latest_is_not_null) {
                        await native_fs_utils._make_path_dirs(versioned_path, fs_context);
                         await native_fs_utils.safe_move(fs_context, latest_ver_path, versioned_path, latest_ver_info,
                            gpfs_options && gpfs_options.delete_version, bucket_tmp_dir_path);
                         if (suspended_and_latest_is_not_null) {
                            // remove a version (or delete marker) with null version ID from .versions/ (if exists)
                            await this._delete_null_version_from_versions_directory(params.key, fs_context);
                        }
                    } else {
                        // versioning suspended and version_id is null
                        dbg.log1('NamespaceFS._delete_latest_version: suspended mode version ID of the latest version is null - file will be unlinked');
                        await native_fs_utils.safe_unlink(fs_context, latest_ver_path, latest_ver_info, gpfs_options, bucket_tmp_dir_path);
                    }
                }
                break;
            } catch (err) {
                retries -= 1;
                if (retries <= 0 || !native_fs_utils.should_retry_link_unlink(is_gpfs, err)) throw err;
                dbg.warn(`NamespaceFS._delete_latest_version: Retrying retries=${retries} latest_ver_path=${latest_ver_path}`, err);
            } finally {
                if (gpfs_options) await this._close_files_gpfs(fs_context, gpfs_options.delete_version, undefined, true);
            }
        }
        // create delete marker and move it to .versions/key_{delete_marker_version_id}
        const created_version_id = await this._create_delete_marker(fs_context, params, latest_ver_info);
        return {
            created_delete_marker: true,
            created_version_id
        };
    }

    // We can have only one versioned object with null version ID per key.
    // It can be latest version, old version in .version/ directory or delete marker
    // This function removes an object version or delete marker with a null version ID inside .version/ directory 
    async _delete_null_version_from_versions_directory(key, fs_context) {
        const is_gpfs = native_fs_utils._is_gpfs(fs_context);
        let retries = config.NSFS_RENAME_RETRIES;
        const null_versioned_path = this._get_version_path(key, NULL_VERSION_ID);
        await this._check_path_in_bucket_boundaries(fs_context, null_versioned_path);

        for (;;) {
            try {
                const null_versioned_path_info = await this._get_version_info(fs_context, null_versioned_path);
                dbg.log1('Namespace_fs._delete_null_version_from_versions_directory:', null_versioned_path, null_versioned_path_info);
                if (null_versioned_path_info) {
                    const gpfs_options = is_gpfs ?
                        await this._open_files_gpfs(fs_context, null_versioned_path, undefined, undefined, undefined, undefined, true) :
                        undefined;
                    const bucket_tmp_dir_path = this.get_bucket_tmpdir_full_path();
                    await native_fs_utils.safe_unlink(fs_context, null_versioned_path, null_versioned_path_info,
                        gpfs_options, bucket_tmp_dir_path);

                    if (gpfs_options) await this._close_files_gpfs(fs_context, gpfs_options.delete_version, undefined, true);
                }
                break;
            } catch (err) {
                retries -= 1;
                if (retries <= 0 || !native_fs_utils.should_retry_link_unlink(is_gpfs, err)) throw err;
                dbg.warn(`NamespaceFS._delete_null_version_from_versions_directory Retrying retries=${retries} null_versioned_path=${null_versioned_path}`, err);
            }
        }
    }

    // TODO: support GPFS
    async _create_delete_marker(fs_context, params, deleted_version_info) {
        let retries = config.NSFS_RENAME_RETRIES;
        let upload_params;
        let delete_marker_version_id;
        for (;;) {
            try {
                upload_params = await this._start_upload(fs_context, undefined, undefined, params, 'w');

                const stat = await upload_params.target_file.stat(fs_context);
                if (this._is_versioning_enabled()) {
                    // the delete marker path built from its version info (mtime + ino)
                    delete_marker_version_id = _get_version_id_by_stat(stat);
                } else {
                    // the delete marker file name would be with a 'null' suffix
                    delete_marker_version_id = NULL_VERSION_ID;
                }
                const file_path = this._get_version_path(params.key, delete_marker_version_id);

                let fs_xattr;
                if (this._is_versioning_suspended() &&
                    (deleted_version_info?.version_id_str === NULL_VERSION_ID)) {
                    fs_xattr = await this._assign_versions_to_fs_xattr(fs_context, undefined,
                        stat, params.key, undefined, true);
                } else {
                    // the previous version will be the deleted version
                    fs_xattr = await this._assign_versions_to_fs_xattr(fs_context, deleted_version_info,
                        stat, params.key, undefined, true);
                }
                if (fs_xattr) await upload_params.target_file.replacexattr(fs_context, fs_xattr);
                // create .version in case we don't have it yet
                await native_fs_utils._make_path_dirs(file_path, fs_context);
                await nb_native().fs.rename(fs_context, upload_params.upload_path, file_path);
                return delete_marker_version_id;
            } catch (err) {
                retries -= 1;
                if (retries <= 0) throw err;
                if (err.code === 'EEXIST') {
                    dbg.warn(`NamespaceFS: _create_delete_marker already exists, success`, err);
                    return delete_marker_version_id;
                }
                dbg.warn(`NamespaceFS: _create_delete_marker failed retries=${retries}`, err);
            } finally {
                if (upload_params) await this.complete_object_upload_finally(undefined, undefined, upload_params.target_file, fs_context);
            }
        }
    }

    async get_prev_version_info(fs_context, key, prev_version_id) {
        const prev_path = this._get_version_path(key, prev_version_id);
        const prev_path_info = await this._get_version_info(fs_context, prev_path);
        return prev_path_info;
    }

    // try find prev version by hint or by iterating on .versions/ dir
    async find_max_version_past(fs_context, key) {
        const versions_dir = path.normalize(path.join(this.bucket_path, path.dirname(key), HIDDEN_VERSIONS_PATH));
        try {
            const versions = await nb_native().fs.readdir(fs_context, versions_dir);
            const arr = await P.map_with_concurrency(10, versions, async entry => {
                const index = entry.name.endsWith('_null') ? entry.name.lastIndexOf('_null') : entry.name.lastIndexOf('_mtime-');
                // don't fail if version entry name is invalid, just keep searching
                if (index < 0 || entry.name.slice(0, index) !== key) return undefined;
                const { mtimeNsBigint } = this._extract_version_info_from_xattr(entry.name.slice(key.length + 1)) ||
                    (await this._get_version_info(fs_context, path.join(versions_dir, entry.name)));
                return { mtimeNsBigint, name: entry.name };
            });

            // find max past version by comparing the mtimeNsBigint val
            const max_entry_info = arr.reduce((acc, cur) => (cur && cur.mtimeNsBigint > acc.mtimeNsBigint ? cur : acc),
                                        { mtimeNsBigint: BigInt(0), name: undefined });
            return max_entry_info.mtimeNsBigint > BigInt(0) &&
                this._get_version_info(fs_context, path.join(versions_dir, max_entry_info.name));
        } catch (err) {
            dbg.warn('namespace_fs.find_max_version_past: .versions/ folder could not be found', err);
       }
    }

    _is_hidden_version_path(dir_key) {
        const idx = dir_key.indexOf(HIDDEN_VERSIONS_PATH);
        return ((idx === 0) || (idx > 0 && dir_key[idx - 1] === '/'));
    }

    ////////////////////////////
    /// MOVE & LINK & UNLINK ///
    ////////////////////////////


    // opens the unopened files involved in the version move during upload/deletion
    // returns an object contains the relevant options for the move/unlink flow
    // eslint-disable-next-line max-params
    async _open_files_gpfs(fs_context, src_path, dst_path, upload_or_dir_file, dst_ver_info, open_mode, delete_version, versioned_info) {
        dbg.log1('Namespace_fs._open_files_gpfs:', src_path, src_path && path.dirname(src_path), dst_path, upload_or_dir_file, dst_ver_info, open_mode, delete_version, versioned_info);

        let src_file;
        let dst_file;
        let dir_file;
        let versioned_file;
        try {
            // open /versions/key_ver file if exists
            versioned_file = versioned_info && await native_fs_utils.open_file(fs_context, this.bucket_path, versioned_info.path, 'r');

            // open files for deletion flow
            if (delete_version) {
                src_file = await native_fs_utils.open_file(fs_context, this.bucket_path, src_path, 'r');
                dir_file = await native_fs_utils.open_file(fs_context, this.bucket_path, path.dirname(src_path), 'r');
                return { delete_version: { src_file, dir_file, dst_file: versioned_file, should_unlink: true } };
            }

            // open files for upload flow
            if (open_mode === 'wt') {
                dir_file = upload_or_dir_file;
            } else {
                src_file = upload_or_dir_file;
                dir_file = await native_fs_utils.open_file(fs_context, this.bucket_path, path.dirname(src_path), 'r');
            }
            if (dst_ver_info) {
                dbg.log1('NamespaceFS._open_files_gpfs dst version exist - opening dst version file...');
                dst_file = await native_fs_utils.open_file(fs_context, this.bucket_path, dst_path, 'r');
            }
            return {
                move_to_versions: { src_file: dst_file, dir_file, dst_file: versioned_file },
                move_to_dst: { src_file, dst_file, dir_file, versioned_file }
            };
        } catch (err) {
            dbg.error('NamespaceFS._open_files_gpfs couldn\'t open files', err);
            await this._close_files_gpfs(fs_context, { src_file, dst_file, dir_file, versioned_file }, open_mode, delete_version);
            throw err;
        }
    }

    // closes files opened during gpfs upload / deletion, avoiding closing files that opened sooner in the process
    async _close_files_gpfs(fs_context, files_to_close, open_mode, delete_version) {
        const { src_file, dst_file = undefined, dir_file, versioned_file = undefined } = files_to_close;
        try {
            if (src_file && (delete_version || open_mode === 'wt')) await src_file.close(fs_context);
        } catch (err) {
            dbg.warn('NamespaceFS: _close_files_gpfs src_file error', err);
        }
        try {
            if (dst_file) await dst_file.close(fs_context);
        } catch (err) {
            dbg.warn('NamespaceFS: _close_files_gpfs dst_file error', err);
        }
        try {
            if (dir_file && (delete_version || open_mode !== 'wt')) await dir_file.close(fs_context);
        } catch (err) {
            dbg.warn('NamespaceFS: _close_files_gpfs dir_file error', err);
        }
        try {
            if (versioned_file) await versioned_file.close(fs_context);
        } catch (err) {
            dbg.warn('NamespaceFS: _close_files_gpfs versioned_file error', err);
        }
    }

    async _throw_if_storage_class_not_supported(storage_class) {
        if (!await this._is_storage_class_supported(storage_class)) {
            throw new S3Error(S3Error.InvalidStorageClass);
        }
    }

    async _is_storage_class_supported(storage_class) {
        if (!storage_class || storage_class === s3_utils.STORAGE_CLASS_STANDARD) return true;

        if (storage_class === s3_utils.STORAGE_CLASS_GLACIER) {
            // TODO: Upon integration with underlying systems, we should
            // check if archiving is actually supported or not
            return config.NSFS_GLACIER_ENABLED || false;
        }

        return false;
    }

    /**
     * @param {nb.NativeFSContext} fs_context
     * @param {number} [size_hint]
     * @returns {Promise<void>}
     */
    async _throw_if_low_space(fs_context, size_hint = 0) {
        if (!config.NSFS_LOW_FREE_SPACE_CHECK_ENABLED) return;

        const MB = 1024 ** 2;
        const { statfs } = await nsfs_bucket_statfs_cache.get_with_cache({ bucket_path: this.bucket_path, fs_context });
        const block_size_mb = statfs.bsize / MB;
        const free_space_mb = Math.floor(statfs.bfree * block_size_mb) - Math.floor(size_hint / MB);
        const total_space_mb = Math.floor(statfs.blocks * block_size_mb);

        const low_space_threshold = this._get_free_space_threshold(
            config.NSFS_LOW_FREE_SPACE_MB,
            config.NSFS_LOW_FREE_SPACE_PERCENT,
            total_space_mb,
        );
        const ok_space_threshold = this._get_free_space_threshold(
            config.NSFS_LOW_FREE_SPACE_MB_UNLEASH,
            config.NSFS_LOW_FREE_SPACE_PERCENT_UNLEASH,
            total_space_mb,
        );

        dbg.log1('_throw_if_low_space:', { free_space_mb, total_space_mb, low_space_threshold, ok_space_threshold });

        if (nsfs_low_space_fsids.has(statfs.fsid)) {
            if (free_space_mb < ok_space_threshold) {
                throw new S3Error(S3Error.SlowDown);
            } else {
                nsfs_low_space_fsids.delete(statfs.fsid);
            }
        } else if (free_space_mb < low_space_threshold) {
            nsfs_low_space_fsids.add(statfs.fsid);
            throw new S3Error(S3Error.SlowDown);
        }
    }

    /**
     * _get_free_space_threshold takes the free space threshold
     * in bytes and in percentage and returns the one that is lower
     * @param {number} in_bytes free space threshold in mb
     * @param {number} in_percentage free space threshold in percentage
     * @param {number} total_space total space in mb
     * @returns {number}
     */
    _get_free_space_threshold(in_bytes, in_percentage, total_space) {
        const free_from_percentage = in_percentage * total_space;
        return Math.max(in_bytes, free_from_percentage);
    }

    async append_to_migrate_wal(entry) {
        if (!config.NSFS_GLACIER_LOGS_ENABLED) return;

        await NamespaceFS.migrate_wal.append(entry);
    }

    async append_to_restore_wal(entry) {
        if (!config.NSFS_GLACIER_LOGS_ENABLED) return;

        await NamespaceFS.restore_wal.append(entry);
    }

    static get migrate_wal() {
        if (!NamespaceFS._migrate_wal) {
            NamespaceFS._migrate_wal = new PersistentLogger(config.NSFS_GLACIER_LOGS_DIR, GlacierBackend.MIGRATE_WAL_NAME, {
                poll_interval: config.NSFS_GLACIER_LOGS_POLL_INTERVAL,
                locking: 'SHARED',
            });
        }

        return NamespaceFS._migrate_wal;
    }

    static get restore_wal() {
        if (!NamespaceFS._restore_wal) {
            NamespaceFS._restore_wal = new PersistentLogger(config.NSFS_GLACIER_LOGS_DIR, GlacierBackend.RESTORE_WAL_NAME, {
                poll_interval: config.NSFS_GLACIER_LOGS_POLL_INTERVAL,
                locking: 'SHARED',
            });
        }

        return NamespaceFS._restore_wal;
    }
}

/** @type {PersistentLogger} */
NamespaceFS._migrate_wal = null;

/** @type {PersistentLogger} */
NamespaceFS._restore_wal = null;

module.exports = NamespaceFS;
module.exports.multi_buffer_pool = multi_buffer_pool;

