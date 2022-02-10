/* Copyright (C) 2020 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const mime = require('mime');
const { v4: uuidv4 } = require('uuid');
const dbg = require('../util/debug_module')(__filename);

const config = require('../../config');
const s3_utils = require('../endpoint/s3/s3_utils');
const stream_utils = require('../util/stream_utils');
const buffer_utils = require('../util/buffer_utils');
const ChunkFS = require('../util/chunk_fs');
const stats_collector = require('./endpoint_stats_collector');
// const http_utils = require('../util/http_utils');
const LRUCache = require('../util/lru_cache');
const Semaphore = require('../util/semaphore');
const nb_native = require('../util/nb_native');
// const RpcError = require('../rpc/rpc_error');

const buffers_pool_sem = new Semaphore(config.NSFS_BUF_POOL_MEM_LIMIT, {
    timeout: config.IO_STREAM_SEMAPHORE_TIMEOUT,
    timeout_error_code: 'IO_STREAM_ITEM_TIMEOUT',
    warning_timeout: config.NSFS_SEM_WARNING_TIMEOUT,
});
const buffers_pool = new buffer_utils.BuffersPool({
    buf_size: config.NSFS_BUF_SIZE,
    sem: buffers_pool_sem,
    warning_timeout: config.NSFS_BUF_POOL_WARNING_TIMEOUT
});

const XATTR_USER_PREFIX = 'user.';
// TODO: In order to verify validity add content_md5_mtime as well
const XATTR_MD5_KEY = XATTR_USER_PREFIX + 'content_md5';

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

function to_xattr(fs_xattr) {
    const xattr = _.mapKeys(fs_xattr, (val, key) =>
        (key.startsWith(XATTR_USER_PREFIX) ? key.slice(XATTR_USER_PREFIX.length) : '')
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


/**
 * @typedef {{
 *  time: number,
 *  stat: fs.Stats,
 *  usage: number,
 *  sorted_entries?: fs.Dirent[],
 * }} ReaddirCacheItem
 * @type {LRUCache<object, string, ReaddirCacheItem>}
 */
const dir_cache = new LRUCache({
    name: 'nsfs-dir-cache',
    make_key: ({ dir_path }) => dir_path,
    load: async ({ dir_path, fs_account_config }) => {
        const time = Date.now();
        const stat = await nb_native().fs.stat(fs_account_config, dir_path);
        let sorted_entries;
        let usage = config.NSFS_DIR_CACHE_MIN_DIR_SIZE;
        if (stat.size <= config.NSFS_DIR_CACHE_MAX_DIR_SIZE) {
            sorted_entries = await nb_native().fs.readdir(fs_account_config, dir_path);
            sorted_entries.sort(sort_entries_by_name);
            for (const ent of sorted_entries) {
                usage += ent.name.length + 4;
            }
        }
        return { time, stat, sorted_entries, usage };
    },
    validate: async ({ stat }, { dir_path, fs_account_config }) => {
        const new_stat = await nb_native().fs.stat(fs_account_config, dir_path);
        return (new_stat.ino === stat.ino && new_stat.mtimeMs === stat.mtimeMs);
    },
    item_usage: ({ usage }, dir_path) => usage,
    max_usage: config.NSFS_DIR_CACHE_MAX_TOTAL_SIZE,
});

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
     * }} params
     */
    constructor({ bucket_path, fs_backend, bucket_id, namespace_resource_id }) {
        dbg.log0('NamespaceFS: buffers_pool', buffers_pool);
        this.bucket_path = path.resolve(bucket_path);
        this.fs_backend = fs_backend;
        this.bucket_id = bucket_id;
        this.namespace_resource_id = namespace_resource_id;
    }

    set_cur_fs_account_config(object_sdk) {
        const fs_config_param = object_sdk &&
            object_sdk.requesting_account && object_sdk.requesting_account.nsfs_account_config;
        if (!fs_config_param) {
            const err = new Error('nsfs_account_config is missing');
            err.rpc_code = 'UNAUTHORIZED';
            throw err;
        }

        fs_config_param.backend = this.fs_backend || '';
        fs_config_param.warn_threshold_ms = config.NSFS_WARN_THRESHOLD_MS;
        return fs_config_param;
    }

    get_bucket_tmpdir() {
        return config.NSFS_TEMP_DIR_NAME + '_' + this.bucket_id;
    }

    get_write_resource() {
        return this;
    }

    get_bucket(bucket) {
        return bucket;
    }

    is_server_side_copy(other, params) {
        const is_server_side_copy = other instanceof NamespaceFS &&
            other.bucket_path === this.bucket_path &&
            other.fs_backend === this.fs_backend && //Check that the same backend type
            params.xattr_copy; // TODO, DO we need to hard link at TaggingDirective 'REPLACE'?
        dbg.log2('NamespaceFS: is_server_side_copy:', is_server_side_copy);
        dbg.log2('NamespaceFS: other instanceof NamespaceFS:', other instanceof NamespaceFS,
            'other.bucket_path:', other.bucket_path, 'this.bucket_path:', this.bucket_path,
            'other.fs_backend', other.fs_backend, 'this.fs_backend', this.fs_backend,
            'params.xattr_copy', params.xattr_copy);
        return is_server_side_copy;
    }

    run_update_issues_report(object_sdk, err) {
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
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_bucket(params, fs_account_config);

            const {
                bucket,
                delimiter = '',
                prefix = '',
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
             *  stat?: fs.Stats,
             *  fs_xattr?: object
             * }} Result
             */

            /** @type {Result[]} */
            const results = [];

            /**
             * @param {string} dir_key
             * @returns {Promise<void>}
             */
            const process_dir = async dir_key => {

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
                 * @param {fs.Dirent} ent
                 */
                const process_entry = async ent => {

                    // dbg.log0('process_entry', dir_key, ent.name);

                    if (!ent.name.startsWith(prefix_ent) ||
                        ent.name < marker_curr ||
                        ent.name === this.get_bucket_tmpdir()) {
                        return;
                    }

                    const r = {
                        key: this._get_entry_key(dir_key, ent),
                        common_prefix: isDirectory(ent),
                    };

                    let pos;
                    if (results.length && r.key < results[results.length - 1].key) {
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

                if (!(await this.check_access(fs_account_config, dir_path))) return;

                try {
                    cached_dir = await dir_cache.get_with_cache({ dir_path, fs_account_config });
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        dbg.log0('NamespaceFS: no keys for non existing dir', dir_path);
                        return;
                    }
                    throw err;
                }

                if (cached_dir.sorted_entries) {
                    const sorted_entries = cached_dir.sorted_entries;
                    const marker_index = _.sortedLastIndexBy(
                        sorted_entries,
                        make_named_dirent(marker_curr),
                        get_entry_name
                    );
                    // handling a scenario in which key_marker points to an object inside a directory
                    // since there can be entries inside the directory that will need to be pushed
                    // to results array
                    if (marker_index) {
                        const prev_dir = sorted_entries[marker_index - 1];
                        const prev_dir_name = path.join(prev_dir.name, '/');
                        if (marker_curr.startsWith(prev_dir_name) && dir_key !== prev_dir.name) {
                            if (!delimiter && isDirectory(prev_dir)) {
                                await process_dir(path.join(dir_key, prev_dir_name));
                            }
                        }
                    }
                    for (let i = marker_index; i < sorted_entries.length; ++i) {
                        const ent = sorted_entries[i];
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
                    dir_handle = await nb_native().fs.opendir(fs_account_config, dir_path); //, { bufferSize: 128 });
                    for (;;) {
                        const dir_entry = await dir_handle.read(fs_account_config);
                        if (!dir_entry) break;
                        await process_entry(dir_entry);
                        // since we dir entries streaming order is not sorted,
                        // we have to keep scanning all the keys before we can stop.
                    }
                    await dir_handle.close(fs_account_config);
                    dir_handle = null;
                } finally {
                    if (dir_handle) {
                        try {
                            dbg.warn('NamespaceFS: close dir streaming', dir_path, 'size', cached_dir.stat.size);
                            await dir_handle.close(fs_account_config);
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
                r.stat = await nb_native().fs.stat(fs_account_config, entry_path);
                // This is done to get the MD5 for the response, should find a more efficient way
                // r.fs_xattr = config.NSFS_CALCULATE_MD5 ? await this._get_fs_xattr_from_path(fs_account_config, entry_path) : undefined;
            }));
            const res = {
                objects: [],
                common_prefixes: [],
                is_truncated,
                next_marker: undefined,
            };
            for (const r of results) {
                if (r.common_prefix) {
                    res.common_prefixes.push(r.key);
                } else {
                    res.objects.push(this._get_object_info(bucket, r.key, r.stat, r.fs_xattr));
                }
                if (res.is_truncated) {
                    res.next_marker = r.key;
                }
            }
            return res;
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async list_object_versions(params, object_sdk) {
        // for now we do not support versioning, so returning the same as list objects
        return this.list_objects(params, object_sdk);
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    async read_object_md(params, object_sdk) {
        let file;
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        try {
            await this._load_bucket(params, fs_account_config);
            const file_path = this._get_file_path(params);
            file = await nb_native().fs.open(fs_account_config, file_path, undefined, get_umasked_mode(config.BASE_MODE_FILE));
            const stat = await file.stat(fs_account_config);
            if (isDirectory(stat)) throw Object.assign(new Error('NoSuchKey'), { code: 'ENOENT' });
            const fs_xattr = await file.getxattr(fs_account_config);
            await file.close(fs_account_config);
            file = null;
            return this._get_object_info(params.bucket, params.key, stat, fs_xattr);
        } catch (err) {
            this.run_update_issues_report(object_sdk, err);
            throw this._translate_object_error_codes(err);
        } finally {
            if (file) await file.close(fs_account_config);
        }
    }

    /*
    async read_object_stream_SLOW(params, object_sdk, res) {
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_bucket(params, fs_account_config);
            const file_path = this._get_file_path(params);
            return fs.createReadStream(file_path, {
                highWaterMark: config.NSFS_BUF_SIZE,
                start: Number.isInteger(params.start) ? params.start : undefined,
                // end offset for files is inclusive, so need to adjust our exclusive end
                end: Number.isInteger(params.end) ? params.end - 1 : undefined,
            });
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }
    */

    async read_object_stream(params, object_sdk, res) {
        let file;
        let buffer_pool_cleanup = null;
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        try {
            await this._load_bucket(params, fs_account_config);
            const file_path = this._get_file_path(params);
            await this._fail_if_archived_or_sparse_file(fs_account_config, file_path);
            file = await nb_native().fs.open(fs_account_config, file_path, undefined, get_umasked_mode(config.BASE_MODE_FILE));

            const start = Number(params.start) || 0;
            const end = isNaN(Number(params.end)) ? Infinity : Number(params.end);

            let num_bytes = 0;
            let num_buffers = 0;
            let log2_size_histogram = {};
            let drain_promise = null;

            dbg.log0('NamespaceFS: read_object_stream', { file_path, start, end });

            let count = 1;
            for (let pos = start; pos < end;) {

                // allocate or reuse buffer
                const remain_size = Math.max(0, end - pos);
                const { buffer, callback } = await buffers_pool.get_buffer();
                buffer_pool_cleanup = callback;

                // read from file
                const read_size = Math.min(buffer.length, remain_size);

                // Update the read stats               
                stats_collector.instance(object_sdk.rpc_client).update_namespace_read_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    bucket_name: params.bucket,
                    size: read_size,
                    count
                });
                // clear count for next updates
                count = 0;

                const bytesRead = await file.read(fs_account_config, buffer, 0, read_size, pos);
                if (!bytesRead) {
                    buffer_pool_cleanup = null;
                    callback();
                    break;
                }
                const data = buffer.slice(0, bytesRead);

                // update stats
                pos += bytesRead;
                num_bytes += bytesRead;
                num_buffers += 1;
                const log2_size = Math.ceil(Math.log2(bytesRead));
                log2_size_histogram[log2_size] = (log2_size_histogram[log2_size] || 0) + 1;

                // wait for response buffer to drain before adding more data if needed - 
                // this occurs when the output network is slower than the input file
                if (drain_promise) {
                    await drain_promise;
                    drain_promise = null;
                }

                // write the data out to response
                buffer_pool_cleanup = null; // cleanup is now in the socket responsibility
                const write_ok = res.write(data, null, callback);
                if (!write_ok) {
                    drain_promise = stream_utils.wait_drain(res);
                }
            }

            await file.close(fs_account_config);
            file = null;
            // wait for the last drain if pending.
            if (drain_promise) {
                await drain_promise;
                drain_promise = null;
            }

            // end the stream
            res.end();
            await stream_utils.wait_finished(res);

            dbg.log0('NamespaceFS: read_object_stream completed', {
                num_bytes,
                num_buffers,
                avg_buffer: num_bytes / num_buffers,
                log2_size_histogram,
            });

            // return null to signal the caller that we already handled the response
            return null;

        } catch (err) {
            throw this._translate_object_error_codes(err);

        } finally {
            try {
                if (file) await file.close(fs_account_config);
            } catch (err) {
                dbg.warn('NamespaceFS: read_object_stream file close error', err);
            }
            try {
                // release buffer back to pool if needed
                if (buffer_pool_cleanup) buffer_pool_cleanup();
            } catch (err) {
                dbg.warn('NamespaceFS: read_object_stream buffer pool cleanup error', err);
            }
        }
    }


    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        await this._load_bucket(params, fs_account_config);

        const file_path = this._get_file_path(params);
        // Uploading to a temp file then we will rename it. 
        const upload_id = uuidv4();
        const upload_path = path.join(this.bucket_path, this.get_bucket_tmpdir(), 'uploads', upload_id);
        let fs_xattr = to_fs_xattr(params.xattr);
        // dbg.log0('NamespaceFS.upload_object:', upload_path, '->', file_path);
        try {
            await this._make_path_dirs(upload_path, fs_account_config);
            if (params.copy_source) {
                const source_file_path = path.join(this.bucket_path, params.copy_source.key);
                await this._fail_if_archived_or_sparse_file(fs_account_config, source_file_path);
                try {
                    const same_inode = await this._is_same_inode(fs_account_config, source_file_path, file_path, fs_xattr);
                    if (same_inode) return same_inode;
                    // Doing a hard link.
                    await nb_native().fs.link(fs_account_config, source_file_path, upload_path);
                } catch (e) {
                    dbg.warn('NamespaceFS: COPY using link failed with:', e);
                    fs_xattr = await this._copy_stream(source_file_path, upload_path, fs_account_config, fs_xattr);
                }
            } else {
                // TODO: Take up only as much as we need (requires fine-tune of the semaphore inside the _upload_stream)
                // Currently we are taking config.NSFS_BUF_SIZE for any sized upload (1KB upload will take a full buffer from semaphore)
                fs_xattr = await buffers_pool_sem.surround_count(
                    config.NSFS_BUF_SIZE,
                    async () => this._upload_stream(params, upload_path, fs_account_config, object_sdk.rpc_client, fs_xattr)
                );
            }
            // TODO use file xattr to store md5_b64 xattr, etc.
            const stat = await nb_native().fs.stat(fs_account_config, upload_path);
            await this._move_to_dest(fs_account_config, upload_path, file_path);
            if (config.NSFS_TRIGGER_FSYNC) await nb_native().fs.fsync(fs_account_config, path.dirname(upload_path));
            return { etag: this._get_etag(stat, fs_xattr) };
        } catch (err) {
            this.run_update_issues_report(object_sdk, err);
            throw this._translate_object_error_codes(err);
        }
    }

    async _move_to_dest(fs_account_config, source_path, dest_path) {
        let retries = config.NSFS_RENAME_RETRIES;
        // will retry renaming a file in case of parallel deleting of the destination path
        for (;;) {
            try {
                await this._make_path_dirs(dest_path, fs_account_config);
                await nb_native().fs.rename(fs_account_config, source_path, dest_path);
                break;
            } catch (err) {
                retries -= 1;
                if (retries <= 0) throw err;
                if (err.code !== 'ENOENT') throw err;
                // checking that the source_path still exists
                if (!await this.check_access(fs_account_config, source_path)) throw err;
                dbg.warn(`NamespaceFS: Retrying failed move to dest retries=${retries}` +
                    ` source_path=${source_path} dest_path=${dest_path}`, err);
            }
        }
    }

    // Comparing both device and inode number (st_dev and st_ino returned by stat) 
    // will tell you whether two different file names refer to the same thing.
    // If so, we will return the etag of the file_path
    async _is_same_inode(fs_account_config, source_file_path, file_path, fs_xattr) {
        try {
            dbg.log2('NamespaceFS: checking _is_same_inode');
            const file_path_stat = await nb_native().fs.stat(fs_account_config, file_path);
            const file_path_inode = file_path_stat.ino.toString();
            const file_path_device = file_path_stat.dev.toString();
            const source_file_stat = await nb_native().fs.stat(fs_account_config, source_file_path);
            const source_file_inode = source_file_stat.ino.toString();
            const source_file_device = source_file_stat.dev.toString();
            dbg.log2('NamespaceFS: file_path_inode:', file_path_inode, 'source_file_inode:', source_file_inode,
                'file_path_device:', file_path_device, 'source_file_device:', source_file_device);
            if (file_path_inode === source_file_inode && file_path_device === source_file_device) {
                return { etag: this._get_etag(file_path_stat, fs_xattr) };
            }
        } catch (e) {
            dbg.log2('NamespaceFS: _is_same_inode got an error', e);
            // If we fail for any reason, we want to return undefined. so doing nothing in this catch.
        }
    }

    async _copy_stream(source_file_path, upload_path, fs_account_config, fs_xattr) {
        let target_file;
        let source_file;
        let buffer_pool_cleanup = null;
        try {
            let MD5Async =
                config.NSFS_CALCULATE_MD5 && !(fs_xattr && fs_xattr[XATTR_MD5_KEY]) ? new (nb_native().crypto.MD5Async)() : undefined;
            //Opening the source and target files
            source_file = await nb_native().fs.open(fs_account_config, source_file_path);
            target_file = await nb_native().fs.open(fs_account_config, upload_path, 'w');
            //Reading the source_file and writing into the target_file
            let read_pos = 0;
            for (;;) {
                const { buffer, callback } = await buffers_pool.get_buffer();
                buffer_pool_cleanup = callback;
                const bytesRead = await source_file.read(fs_account_config, buffer, 0, config.NSFS_BUF_SIZE, read_pos);
                if (!bytesRead) {
                    buffer_pool_cleanup = null;
                    callback();
                    break;
                }
                read_pos += bytesRead;
                const data = buffer.slice(0, bytesRead);
                if (MD5Async) await MD5Async.update(data);
                await target_file.write(fs_account_config, data);
                // Returns the buffer to pool to avoid starvation
                buffer_pool_cleanup = null;
                callback();
            }
            if (MD5Async) {
                fs_xattr = this._assign_md5_to_fs_xattr((await MD5Async.digest()).toString('hex'), fs_xattr);
            }
            if (fs_xattr) {
                await target_file.setxattr(fs_account_config, fs_xattr);
            }
            //Closing the source_file and target files
            await source_file.close(fs_account_config);
            source_file = null;
            await target_file.fsync(fs_account_config);
            await target_file.close(fs_account_config);
            target_file = null;
            // Used for etag
            return fs_xattr;
        } catch (e) {
            dbg.error('Failed to copy object', e);
            throw e;
        } finally {
            try {
                // release buffer back to pool if needed
                if (buffer_pool_cleanup) buffer_pool_cleanup();
            } catch (err) {
                dbg.warn('NamespaceFS: upload_object - copy_source buffer pool cleanup error', err);
            }
            try {
                if (source_file) await source_file.close(fs_account_config);
            } catch (err) {
                dbg.warn('NamespaceFS: upload_object - copy_source source_file close error', err);
            }
            try {
                if (target_file) await target_file.close(fs_account_config);
            } catch (err) {
                dbg.warn('NamespaceFS: upload_object - copy_source target_file close error', err);
            }
        }
    }

    // Allocated config.NSFS_BUF_SIZE in Semaphore but in fact we can take up more inside
    // This is due to MD5 calculation and data buffers
    // Can be finetuned further on if needed and inserting the Semaphore logic inside
    // Instead of wrapping the whole _upload_stream function (q_buffers lives outside of the data scope of the stream)
    async _upload_stream(params, upload_path, fs_account_config, rpc_client, fs_xattr) {
        let target_file;
        const { source_stream, md5_b64, key, bucket, upload_id } = params;
        try {
            target_file = await nb_native().fs.open(fs_account_config, upload_path, 'w', get_umasked_mode(config.BASE_MODE_FILE));
            // Not using async iterators with ReadableStreams due to unsettled promises issues on abort/destroy
            const chunk_fs = new ChunkFS({
                target_file,
                fs_account_config,
                rpc_client,
                namespace_resource_id: this.namespace_resource_id
            });
            await stream_utils.pipeline([source_stream, chunk_fs]);
            await stream_utils.wait_finished(chunk_fs);
            if (chunk_fs.digest) {
                if (md5_b64) {
                    const md5_hex = Buffer.from(md5_b64, 'base64').toString('hex');
                    if (md5_hex !== chunk_fs.digest) throw new Error('_upload_stream mismatch etag: ' + util.inspect({ key, bucket, upload_id, md5_hex, digest: chunk_fs.digest }));
                }
                fs_xattr = this._assign_md5_to_fs_xattr(chunk_fs.digest, fs_xattr);
            }
            if (fs_xattr) {
                await target_file.setxattr(fs_account_config, fs_xattr);
            }
            await target_file.fsync(fs_account_config);
            // Used for etag
            return fs_xattr;
        } catch (error) {
            dbg.error('_upload_stream had error: ', error);
            throw error;
        } finally {
            try {
                if (target_file) await target_file.close(fs_account_config);
            } catch (err) {
                dbg.warn('NamespaceFS: _upload_stream file close error', err);
            }
        }
    }

    //////////////////////
    // MULTIPART UPLOAD //
    //////////////////////

    async list_uploads(params, object_sdk) {
        // TODO for now we do not support listing of multipart uploads
        return {
            objects: [],
            common_prefixes: [],
            is_truncated: false,
            next_marker: undefined,
            next_upload_id_marker: undefined,
        };
    }

    async create_object_upload(params, object_sdk) {
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_bucket(params, fs_account_config);
            params.obj_id = uuidv4();
            params.mpu_path = this._mpu_path(params);
            await this._create_path(params.mpu_path, fs_account_config);
            const create_params = JSON.stringify({ ...params, source_stream: null });
            await nb_native().fs.writeFile(
                fs_account_config,
                path.join(params.mpu_path, 'create_object_upload'),
                Buffer.from(create_params),
                get_umasked_mode(config.BASE_MODE_FILE)
            );
            return { obj_id: params.obj_id };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async upload_multipart(params, object_sdk) {
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_multipart(params, fs_account_config);
            const upload_path = path.join(params.mpu_path, `part-${params.num}`);
            // Will get populated in _upload_stream with the MD5 (if MD5 calculation is enabled)
            const fs_xattr = await buffers_pool_sem.surround_count(
                config.NSFS_BUF_SIZE,
                async () => this._upload_stream(params, upload_path, fs_account_config, object_sdk.rpc_client)
            );
            const stat = await nb_native().fs.stat(fs_account_config, upload_path);
            return { etag: this._get_etag(stat, fs_xattr) };
        } catch (err) {
            this.run_update_issues_report(object_sdk, err);
            throw this._translate_object_error_codes(err);
        }
    }

    async list_multiparts(params, object_sdk) {
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_multipart(params, fs_account_config);
            const entries = await nb_native().fs.readdir(fs_account_config, params.mpu_path);
            const multiparts = await Promise.all(
                entries
                .filter(e => e.name.startsWith('part-'))
                .map(async e => {
                    const num = Number(e.name.slice('part-'.length));
                    const part_path = path.join(params.mpu_path, e.name);
                    const stat = await nb_native().fs.stat(fs_account_config, part_path);
                    const fs_xattr =
                        config.NSFS_CALCULATE_MD5 ? await this._get_fs_xattr_from_path(fs_account_config, part_path) : undefined;
                    return {
                        num,
                        size: stat.size,
                        etag: this._get_etag(stat, fs_xattr),
                        last_modified: new Date(stat.mtime),
                    };
                })
            );
            return {
                is_truncated: false,
                next_num_marker: undefined,
                multiparts,
            };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async complete_object_upload(params, object_sdk) {
        let read_file;
        let write_file;
        let buffer_pool_cleanup = null;
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        try {
            let MD5Async = config.NSFS_CALCULATE_MD5 ? new (nb_native().crypto.MD5Async)() : undefined;
            const { multiparts = [] } = params;
            multiparts.sort((a, b) => a.num - b.num);
            await this._load_multipart(params, fs_account_config);
            const file_path = this._get_file_path(params);
            const upload_path = path.join(params.mpu_path, 'final');
            write_file = await nb_native().fs.open(fs_account_config, upload_path, 'w', get_umasked_mode(config.BASE_MODE_FILE));
            for (const { num, etag } of multiparts) {
                const part_path = path.join(params.mpu_path, `part-${num}`);
                const part_stat = await nb_native().fs.stat(fs_account_config, part_path);
                read_file = await nb_native().fs.open(fs_account_config, part_path, undefined, get_umasked_mode(config.BASE_MODE_FILE));
                // Assuming that a every multipart upload object uses the same NSFS_CALCULATE_MD5 configuration
                const fs_xattr = MD5Async ? await read_file.getxattr(fs_account_config) : undefined;
                // TODO: Should we seperate to two cases and save the open if we do not use NSFS_CALCULATE_MD5?
                if (etag !== this._get_etag(part_stat, fs_xattr)) {
                    throw new Error('mismatch part etag: ' +
                        util.inspect({ num, etag, part_path, part_stat, params }));
                }
                let read_pos = 0;
                for (;;) {
                    const { buffer, callback } = await buffers_pool.get_buffer();
                    buffer_pool_cleanup = callback;
                    const bytesRead = await read_file.read(fs_account_config, buffer, 0, config.NSFS_BUF_SIZE, read_pos);
                    if (!bytesRead) {
                        // Returns the buffer to pool to avoid starvation
                        buffer_pool_cleanup = null;
                        callback();
                        break;
                    }
                    read_pos += bytesRead;
                    const data = buffer.slice(0, bytesRead);
                    await write_file.write(fs_account_config, data);
                    // Returns the buffer to pool to avoid starvation
                    buffer_pool_cleanup = null;
                    callback();
                }
                await read_file.close(fs_account_config);
                read_file = null;
                if (MD5Async) await MD5Async.update(Buffer.from(etag, 'hex'));
            }
            const create_params_buffer = await nb_native().fs.readFile(
                fs_account_config,
                path.join(params.mpu_path, 'create_object_upload')
            );
            const { xattr } = JSON.parse(create_params_buffer);
            let fs_xattr = to_fs_xattr(xattr);
            if (MD5Async) fs_xattr = this._assign_md5_to_fs_xattr(((await MD5Async.digest()).toString('hex')) + '-' + multiparts.length, fs_xattr);
            if (fs_xattr) await write_file.setxattr(fs_account_config, fs_xattr);
            if (config.NSFS_TRIGGER_FSYNC) await write_file.fsync(fs_account_config);
            const stat = await write_file.stat(fs_account_config);
            await write_file.close(fs_account_config);
            write_file = null;
            await this._move_to_dest(fs_account_config, upload_path, file_path);
            if (config.NSFS_REMOVE_PARTS_ON_COMPLETE) await this._folder_delete(params.mpu_path, fs_account_config);
            return { etag: this._get_etag(stat, fs_xattr) };
        } catch (err) {
            dbg.error(err);
            throw this._translate_object_error_codes(err);
        } finally {
            try {
                // release buffer back to pool if needed
                if (buffer_pool_cleanup) buffer_pool_cleanup();
            } catch (err) {
                dbg.warn('NamespaceFS: complete_object_upload buffer pool cleanup error', err);
            }
            try {
                if (read_file) await read_file.close(fs_account_config);
            } catch (err) {
                dbg.warn('NamespaceFS: complete_object_upload read file close error', err);
            }
            try {
                if (write_file) await write_file.close(fs_account_config);
            } catch (err) {
                dbg.warn('NamespaceFS: complete_object_upload write file close error', err);
            }
        }
    }

    async abort_object_upload(params, object_sdk) {
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        await this._load_multipart(params, fs_account_config);
        dbg.log0('NamespaceFS: abort_object_upload', params.mpu_path);
        await this._folder_delete(params.mpu_path, fs_account_config);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_bucket(params, fs_account_config);
            const file_path = this._get_file_path(params);
            dbg.log0('NamespaceFS: delete_object', file_path);
            await nb_native().fs.unlink(fs_account_config, file_path);
            await this._delete_path_dirs(file_path, fs_account_config);
            return {};
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async delete_multiple_objects(params, object_sdk) {
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_bucket(params, fs_account_config);
            for (const { key } of params.objects) {
                const file_path = this._get_file_path({ key });
                dbg.log0('NamespaceFS: delete_multiple_objects', file_path);
                await nb_native().fs.unlink(fs_account_config, file_path);
                await this._delete_path_dirs(file_path, fs_account_config);
            }
            // TODO return deletion reponse per key
            return params.objects.map(() => ({}));
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async get_object_tagging(params, object_sdk) {
        // TODO
        return { tagging: [] };
    }
    async delete_object_tagging(params, object_sdk) {
        // TODO
        return {};
    }
    async put_object_tagging(params, object_sdk) {
        // TODO
        return { tagging: [] };
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

    ///////////////
    // INTERNALS //
    ///////////////

    _get_file_path({ key }) {
        // not allowing keys with dots follow by slash which can be treated as relative paths and "leave" the bucket_path
        // We are not using `path.isAbsolute` as path like '/../..' will return true and we can still "leave" the bucket_path
        if (key.includes('./')) throw new Error('Bad relative path key ' + key);

        // using normalize to get rid of multiple slashes in the middle of the path (but allows single trailing /)
        const p = path.normalize(path.join(this.bucket_path, key));

        // when the key refers to a directory (trailing /) we append a unique entry name
        // so that we can upload/download the object content to that dir entry.
        return p.endsWith('/') ? p + config.NSFS_FOLDER_OBJECT_NAME : p;
    }

    _assign_md5_to_fs_xattr(md5_digest, fs_xattr) {
        // TODO: Assign content_md5_mtime
        fs_xattr = Object.assign(fs_xattr || {}, {
            [XATTR_MD5_KEY]: md5_digest
        });
        return fs_xattr;
    }

    // TODO: Can be changed to get MD5 attributes only
    async _get_fs_xattr_from_path(fs_account_config, file_path) {
        let file;
        try {
            file = await nb_native().fs.open(fs_account_config, file_path, undefined, get_umasked_mode(config.BASE_MODE_FILE));
            const fs_xattr = await file.getxattr(fs_account_config);
            await file.close(fs_account_config);
            file = null;
            return fs_xattr;
        } catch (error) {
            throw this._translate_object_error_codes(error);
        } finally {
            if (file) await file.close(fs_account_config);
        }
    }

    /**
     * @param {string} dir_key 
     * @param {fs.Dirent} ent 
     * @returns {string} 
     */
    _get_entry_key(dir_key, ent) {
        if (ent.name === config.NSFS_FOLDER_OBJECT_NAME) return dir_key;
        return dir_key + ent.name + (isDirectory(ent) ? '/' : '');
    }

    async _make_path_dirs(file_path, fs_account_config) {
        const last_dir_pos = file_path.lastIndexOf('/');
        if (last_dir_pos > 0) return this._create_path(file_path.slice(0, last_dir_pos), fs_account_config);
    }

    /**
     * @param {fs.Stats} stat 
     * @returns {string}
     */
    _get_etag(stat, fs_xattr) {
        const xattr_etag = this._etag_from_fs_xattr(fs_xattr);
        if (xattr_etag) return xattr_etag;
        // IMPORTANT NOTICE - we must return an etag that contains a dash!
        // because this is the criteria of S3 SDK to decide if etag represents md5
        // and perform md5 validation of the data.
        const ident_str = 'inode-' + stat.ino.toString() + '-mtime-' + stat.mtimeMs.toString();
        return ident_str;
    }

    _etag_from_fs_xattr(xattr) {
        if (_.isEmpty(xattr)) return undefined;
        return xattr[XATTR_MD5_KEY];
    }

    /**
     * @param {string} bucket 
     * @param {string} key 
     * @returns {nb.ObjectInfo}
     */
    _get_object_info(bucket, key, stat, fs_xattr) {
        const etag = this._get_etag(stat, fs_xattr);
        return {
            obj_id: etag,
            bucket,
            key,
            etag,
            size: stat.size,
            create_time: stat.mtime.getTime(),
            content_type: mime.getType(key) || 'application/octet-stream',
            // temp:
            version_id: '1',
            is_latest: true,
            delete_marker: false,
            tag_count: 0,
            xattr: to_xattr(fs_xattr),
            encryption: undefined,
            lock_settings: undefined,
            md5_b64: undefined,
            num_parts: undefined,
            sha256_b64: undefined,
            stats: undefined,
            tagging: undefined,
        };
    }

    _translate_object_error_codes(err) {
        if (err.rpc_code) return err;
        if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_OBJECT';
        if (err.code === 'EEXIST') err.rpc_code = 'BUCKET_ALREADY_EXISTS';
        if (err.code === 'EPERM' || err.code === 'EACCES') err.rpc_code = 'UNAUTHORIZED';
        if (err.code === 'IO_STREAM_ITEM_TIMEOUT') err.rpc_code = 'IO_STREAM_ITEM_TIMEOUT';
        return err;
    }

    async _load_bucket(params, fs_account_config) {
        try {
            await nb_native().fs.stat(fs_account_config, this.bucket_path);
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    _mpu_path(params) {
        return path.join(
            this.bucket_path,
            this.get_bucket_tmpdir(),
            'multipart-uploads',
            params.obj_id
        );
    }

    async _load_multipart(params, fs_account_config) {
        await this._load_bucket(params, fs_account_config);
        params.mpu_path = this._mpu_path(params);
        try {
            await nb_native().fs.stat(fs_account_config, params.mpu_path);
        } catch (err) {
            // TOOD: Error handling
            if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_UPLOAD';
            throw err;
        }
    }

    async _create_path(dir, fs_account_config) {
        let dir_path = path.isAbsolute(dir) ? path.sep : '';
        for (const item of dir.split(path.sep)) {
            dir_path = path.join(dir_path, item);
            try {
                await nb_native().fs.mkdir(fs_account_config, dir_path, get_umasked_mode(config.BASE_MODE_DIR));
            } catch (err) {
                const ERR_CODES = ['EISDIR', 'EEXIST'];
                if (!ERR_CODES.includes(err.code)) throw err;
            }
        }
        await nb_native().fs.fsync(fs_account_config, dir_path);
    }

    async _delete_path_dirs(file_path, fs_account_config) {
        try {
            let dir = path.dirname(file_path);
            while (dir !== this.bucket_path) {
                await nb_native().fs.rmdir(fs_account_config, dir);
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

    async _folder_delete(dir, fs_account_config) {
        let entries = await nb_native().fs.readdir(fs_account_config, dir);
        let results = await Promise.all(entries.map(entry => {
            let fullPath = path.join(dir, entry.name);
            let task = isDirectory(entry) ? this._folder_delete(fullPath, fs_account_config) :
                nb_native().fs.unlink(fs_account_config, fullPath);
            return task.catch(error => ({ error }));
        }));
        results.forEach(result => {
            // Ignore missing files/directories; bail on other errors
            if (result && result.error && result.error.code !== 'ENOENT') throw result.error;
        });
        await nb_native().fs.rmdir(fs_account_config, dir);
    }

    async create_uls(params, object_sdk) {
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        dbg.log0('NamespaceFS: create_uls fs_account_config:', fs_account_config, 'new_dir_path: ', params.full_path);
        try {
            await nb_native().fs.mkdir(fs_account_config, params.full_path, get_umasked_mode(0o777));
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async delete_uls(params, object_sdk) {
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        dbg.log0('NamespaceFS: delete_uls fs_account_config:', fs_account_config, 'to_delete_dir_path: ', params.full_path);

        try {
            const list = await this.list_objects({ ...params, limit: 1 }, object_sdk);

            if (list && list.objects && list.objects.length > 0) {
                const err = new Error('underlying directory has files in it');
                err.rpc_code = 'NOT_EMPTY';
                throw err;
            }

            await this._folder_delete(params.full_path, fs_account_config);
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async check_access(fs_account_config, dir_path) {
        try {
            dbg.log0('check_access: dir_path', dir_path, 'fs_account_config', fs_account_config);
            await nb_native().fs.checkAccess(fs_account_config, dir_path);
            return true;
        } catch (err) {
            dbg.error('check_access: error ', err.code, err, dir_path, this.bucket_path);
            const is_bucket_dir = dir_path === this.bucket_path;

            // if dir_path is the bucket path we would like to throw an error 
            // for other dirs we will skip
            if (['EPERM', 'EACCES'].includes(err.code) && !is_bucket_dir) {
                return false;
            }
            if (err.code === 'ENOENT' && !is_bucket_dir) {
                // invalidate if dir
                dir_cache.invalidate({ dir_path, fs_account_config });
                return false;
            }
            throw err;
        }
    }

    // TODO: Return/Refactor check after handling of FSync
    async _fail_if_archived_or_sparse_file(fs_account_config, file_path) {
        // const stat = await nb_native().fs.stat(fs_account_config, file_path);
        // if (isDirectory(stat)) return;
        // // In order to verify if the file is stored in tape we compare sizes
        // // Multiple number of blocks by default block size and verify we get the size of the object
        // // If we get a size that is lower than the size of the object this means that it is taped or a spare file
        // // We had to use this logic since we do not have a POSIX call in order to verify that the file is taped
        // // This is why sparse files won't be accessible as well
        // if (stat.blocks * 512 < stat.size) {
        //     dbg.log0(`_fail_if_archived_or_sparse_file: ${file_path} rejected`, stat);
        //     throw new RpcError('INVALID_OBJECT_STATE', 'Attempted to access archived or sparse file');
        // }
    }
}

module.exports = NamespaceFS;
