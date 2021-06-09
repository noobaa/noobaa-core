/* Copyright (C) 2020 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const mime = require('mime');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const config = require('../../config');
const s3_utils = require('../endpoint/s3/s3_utils');
const stream_utils = require('../util/stream_utils');
const buffer_utils = require('../util/buffer_utils');
const LRUCache = require('../util/lru_cache');
const Semaphore = require('../util/semaphore');
const nb_native = require('../util/nb_native');

const buffers_pool_sem = new Semaphore(config.NSFS_BUF_POOL_MEM_LIMIT);
const buffers_pool = new buffer_utils.BuffersPool(config.NSFS_BUF_SIZE, buffers_pool_sem);

const hash = crypto.createHash('md5');

/*const DEFAULT_FS_CONFIG = {
    uid: Number(process.env.NSFS_UID) || process.getuid(),
    gid: Number(process.env.NSFS_GID) || process.getgid(),
    backend: ''
};*/

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
        let new_stat;
        try {
            new_stat = await nb_native().fs.stat(fs_account_config, dir_path);
        } catch (err) {
            // temporary solution: invalidating - should be more efficient  
            return false;
        }
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
     * }} params
     */
    constructor({ bucket_path, fs_backend, bucket_id }) {
        console.log('NamespaceFS: buffers_pool', buffers_pool);
        this.bucket_path = path.resolve(bucket_path);
        this.fs_backend = fs_backend;
        this.bucket_id = bucket_id;
        this.etag_md5 = true; //LMLM Remove and replace from the .nsfs_config.etag_md5
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
        return other instanceof NamespaceFS &&
            other.bucket_path === this.bucket_path &&
            other.fs_backend === this.fs_backend && //Check that the same backend type
            params.xattr_copy; // TODO, DO we need to hard link at TaggingDirective 'REPLACE'?
    }

    // get a stream and returns it's md5_b64
    get_stream_md5_b64(stream) {
        const md5_stream = stream_utils.get_stream_md5();
        stream.pipe(md5_stream);
        const md5_b64 = md5_stream.md5.digest('base64');
        return md5_b64;
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
                    // console.log(`prefix dir does not match so no keys in this dir can apply: dir_key=${dir_key} prefix_dir=${prefix_dir}`);
                    return;
                }

                const marker_dir = key_marker.slice(0, dir_key.length);
                const marker_ent = key_marker.slice(dir_key.length);
                // marker is after dir so no keys in this dir can apply
                if (dir_key < marker_dir) {
                    // console.log(`marker is after dir so no keys in this dir can apply: dir_key=${dir_key} marker_dir=${marker_dir}`);
                    return;
                }
                // when the dir portion of the marker is completely below the current dir
                // then every key in this dir satisfies the marker and marker_ent should not be used.
                const marker_curr = (marker_dir < dir_key) ? '' : marker_ent;

                // console.log(`process_dir: dir_key=${dir_key} prefix_ent=${prefix_ent} marker_curr=${marker_curr}`);

                /**
                 * @param {fs.Dirent} ent
                 */
                const process_entry = async ent => {

                    // console.log('process_entry', dir_key, ent.name);

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

                try {
                    cached_dir = await dir_cache.get_with_cache({ dir_path, fs_account_config });
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        console.log('NamespaceFS: no keys for non existing dir', dir_path);
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
                    for (let i = marker_index; i < sorted_entries.length; ++i) {
                        const ent = sorted_entries[i];
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
                    console.warn('NamespaceFS: open dir streaming', dir_path, 'size', cached_dir.stat.size);
                    dir_handle = await nb_native().fs.opendir(fs_account_config, dir_path); //, { bufferSize: 128 });
                    for await (const ent of dir_handle) {
                        await process_entry(ent);
                        // since we dir entries streaming order is not sorted,
                        // we have to keep scanning all the keys before we can stop.
                    }
                } finally {
                    if (dir_handle) {
                        try {
                            console.warn('NamespaceFS: close dir streaming', dir_path, 'size', cached_dir.stat.size);
                            await dir_handle.close(fs_account_config);
                        } catch (err) {
                            console.error('NamespaceFS: close dir failed', err);
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
                    res.objects.push(this._get_object_info(bucket, r.key, r.stat));
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
        try {
            const fs_account_config = this.set_cur_fs_account_config(object_sdk);
            await this._load_bucket(params, fs_account_config);
            const file_path = this._get_file_path(params);
            const stat = await nb_native().fs.stat(fs_account_config, file_path);
            console.log(file_path, stat);
            if (isDirectory(stat)) throw Object.assign(new Error('NoSuchKey'), { code: 'ENOENT' });
            return this._get_object_info(params.bucket, params.key, stat);
        } catch (err) {
            throw this._translate_object_error_codes(err);
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
            file = await nb_native().fs.open(fs_account_config, file_path, undefined, get_umasked_mode(config.BASE_MODE_FILE));

            const start = Number(params.start) || 0;
            const end = isNaN(Number(params.end)) ? Infinity : Number(params.end);

            let num_bytes = 0;
            let num_buffers = 0;
            let log2_size_histogram = {};
            let drain_promise = null;

            console.log('NamespaceFS: read_object_stream', { file_path, start, end });

            for (let pos = start; pos < end;) {

                // allocate or reuse buffer
                const remain_size = Math.max(0, end - pos);
                const { buffer, callback } = await buffers_pool.get_buffer(remain_size);
                buffer_pool_cleanup = callback;

                // read from file
                const read_size = Math.min(buffer.length, remain_size);
                const bytesRead = await file.read(fs_account_config, buffer, 0, read_size, pos);
                if (!bytesRead) break;
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

            // wait for the last drain if pending.
            if (drain_promise) {
                await drain_promise;
                drain_promise = null;
            }

            // end the stream
            res.end();
            await stream_utils.wait_finished(res);

            console.log('NamespaceFS: read_object_stream completed', {
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
                console.warn('NamespaceFS: read_object_stream file close error', err);
            }
            try {
                // release buffer back to pool if needed
                if (buffer_pool_cleanup) buffer_pool_cleanup();
            } catch (err) {
                console.warn('NamespaceFS: read_object_stream buffer pool cleanup error', err);
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
        // console.log('NamespaceFS.upload_object:', upload_path, '->', file_path);
        try {
            await Promise.all([this._make_path_dirs(file_path, fs_account_config), this._make_path_dirs(upload_path, fs_account_config)]);
            if (params.copy_source) {
                const source_file_path = path.join(this.bucket_path, params.copy_source.key);
                try {
                    const same_inode = await this._is_same_inode(fs_account_config, source_file_path, file_path);
                    if (same_inode) return same_inode;
                    // Doing a hard link.
                    await nb_native().fs.link(fs_account_config, source_file_path, upload_path);
                } catch (e) {
                    console.warn('NamespaceFS: COPY using link failed with:', e);
                    await this._copy_stream(source_file_path, upload_path, fs_account_config);
                }
            } else {
                await this._upload_stream(params.source_stream, upload_path, fs_account_config);
                if (this.etag_md5) {
                    const md5_b64 = this.get_stream_md5_b64(params.source_stream);
                    console.log('Temp, printing till we have xattr:', md5_b64);
                }
            }
            // TODO use file xattr to store md5_b64 xattr, etc.
            const stat = await nb_native().fs.stat(fs_account_config, upload_path);
            await nb_native().fs.rename(fs_account_config, upload_path, file_path);
            return { etag: this._get_etag(stat) };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    // Comparing both device and inode number (st_dev and st_ino returned by stat) 
    // will tell you whether two different file names refer to the same thing.
    // If so, we will return the etag of the file_path
    async _is_same_inode(fs_account_config, source_file_path, file_path) {
        try {
            const file_path_stat = await nb_native().fs.stat(fs_account_config, file_path);
            const file_path_inode = file_path_stat.ino.toString();
            const file_path_device = file_path_stat.dev.toString();
            const source_file_stat = await nb_native().fs.stat(fs_account_config, source_file_path);
            const source_file_inode = source_file_stat.ino.toString();
            const source_file_device = source_file_stat.dev.toString();
            //LMLM TODO: question: do we need to tack care of a case where we want md5?
            // this flow will not be called when we get params.xattr_copy, will we still want to get the md5?
            if (file_path_inode === source_file_inode && file_path_device === source_file_device) {
                return { etag: this._get_etag(file_path_stat) };
            }
        } catch (e) {
            // If we fail for any reason, we want to return undefined. so doing nothing in this catch.
        }
    }

    async _copy_stream(source_file_path, upload_path, fs_account_config) {
        let target_file;
        let source_file;
        let buffer_pool_cleanup = null;
        try {
            //Opening the source and target files
            source_file = await nb_native().fs.open(fs_account_config, source_file_path);
            target_file = await nb_native().fs.open(fs_account_config, upload_path, 'w');
            //Reading the source_file and writing into the target_file
            let read_pos = 0;
            for (;;) {
                const { buffer, callback } = await buffers_pool.get_buffer(config.NSFS_BUF_SIZE);
                buffer_pool_cleanup = callback;
                if (this.etag_md5) {
                    const md5_b64 = hash.update(buffer).digest('base64');
                    console.log('Temp, printing till we have xattr:', md5_b64);
                }
                const bytesRead = await source_file.read(fs_account_config, buffer, 0, config.NSFS_BUF_SIZE, read_pos);
                if (!bytesRead) break;
                read_pos += bytesRead;
                const data = buffer.slice(0, bytesRead);
                await target_file.write(fs_account_config, data);
                // Returns the buffer to pool to avoid starvation
                buffer_pool_cleanup = null;
                callback();
            }
            //Closing the source_file and target files
            await source_file.close(fs_account_config);
            source_file = null;
            await target_file.close(fs_account_config);
            target_file = null;
        } catch (e) {
            console.error('Failed to copy object', e);
            throw e;
        } finally {
            try {
                // release buffer back to pool if needed
                if (buffer_pool_cleanup) buffer_pool_cleanup();
            } catch (err) {
                console.warn('NamespaceFS: upload_object - copy_source buffer pool cleanup error', err);
            }
            try {
                if (source_file) await source_file.close(fs_account_config);
                if (target_file) await target_file.close(fs_account_config);
            } catch (err) {
                console.warn('NamespaceFS: upload_object - copy_source file close error', err);
            }
        }
    }

    async _upload_stream(source_stream, upload_path, fs_account_config) {
        let target_file;
        try {
            let q_buffers = [];
            let q_size = 0;
            target_file = await nb_native().fs.open(fs_account_config, upload_path, 'w', get_umasked_mode(config.BASE_MODE_FILE));
            const flush = async () => {
                if (q_buffers.length) {
                    await target_file.writev(fs_account_config, q_buffers);
                    q_buffers = [];
                    q_size = 0;
                }
            };
            for await (let data of source_stream) {
                while (data && data.length) {
                    const available_size = config.NSFS_BUF_SIZE - q_size;
                    const buf = (available_size < data.length) ? data.slice(0, available_size) : data;
                    q_buffers.push(buf);
                    q_size += buf.length;
                    if (q_size === config.NSFS_BUF_SIZE) await flush();
                    data = (available_size < data.length) ? data.slice(available_size) : null;
                }
            }
            await flush();
        } catch (error) {
            console.error('_upload_stream had error: ', error);
            throw error;
        } finally {
            try {
                if (target_file) await target_file.close(fs_account_config);
            } catch (err) {
                console.warn('NamespaceFS: _upload_stream file close error', err);
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
            await nb_native().fs.writeFile(fs_account_config, path.join(params.mpu_path, 'create_object_upload'), Buffer.from(create_params));
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
            await this._upload_stream(params.source_stream, upload_path, fs_account_config);
            if (this.etag_md5) {
                const md5_b64 = this.get_stream_md5_b64(params.source_stream);
                console.log('Temp, printing till we have xattr:', md5_b64);
            }
            const stat = await nb_native().fs.stat(fs_account_config, upload_path);
            return { etag: this._get_etag(stat) };
        } catch (err) {
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
            const { multiparts = [] } = params;
            multiparts.sort((a, b) => a.num - b.num);
            await this._load_multipart(params, fs_account_config);
            const file_path = this._get_file_path(params);
            const upload_path = path.join(params.mpu_path, 'final');
            write_file = await nb_native().fs.open(fs_account_config, upload_path, 'w', get_umasked_mode(config.BASE_MODE_FILE));
            for (const { num, etag } of multiparts) {
                const part_path = path.join(params.mpu_path, `part-${num}`);
                const part_stat = await nb_native().fs.stat(fs_account_config, part_path);
                if (etag !== this._get_etag(part_stat)) {
                    throw new Error('mismatch part etag: ' +
                        util.inspect({ num, etag, part_path, part_stat, params }));
                }
                read_file = await nb_native().fs.open(fs_account_config, part_path, undefined, get_umasked_mode(config.BASE_MODE_FILE));
                let read_pos = 0;
                for (;;) {
                    const { buffer, callback } = await buffers_pool.get_buffer(config.NSFS_BUF_SIZE);
                    buffer_pool_cleanup = callback;
                    const bytesRead = await read_file.read(fs_account_config, buffer, 0, config.NSFS_BUF_SIZE, read_pos);
                    if (!bytesRead) break;
                    read_pos += bytesRead;
                    const data = buffer.slice(0, bytesRead);
                    await write_file.write(fs_account_config, data);
                    // Returns the buffer to pool to avoid starvation
                    buffer_pool_cleanup = null;
                    callback();
                }
                await read_file.close(fs_account_config);
                read_file = null;
            }
            await write_file.close(fs_account_config);
            write_file = null;
            const stat = await nb_native().fs.stat(fs_account_config, upload_path);
            await nb_native().fs.rename(fs_account_config, upload_path, file_path);
            await this._folder_delete(params.mpu_path, fs_account_config);
            return { etag: this._get_etag(stat) };
        } catch (err) {
            console.error(err);
            throw this._translate_object_error_codes(err);
        } finally {
            try {
                // release buffer back to pool if needed
                if (buffer_pool_cleanup) buffer_pool_cleanup();
            } catch (err) {
                console.warn('NamespaceFS: complete_object_upload buffer pool cleanup error', err);
            }
            try {
                if (read_file) await read_file.close(fs_account_config);
                if (write_file) await write_file.close(fs_account_config);
            } catch (err) {
                console.warn('NamespaceFS: complete_object_upload file close error', err);
            }
        }
    }

    async abort_object_upload(params, object_sdk) {
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        await this._load_multipart(params, fs_account_config);
        console.log('NamespaceFS: abort_object_upload', params.mpu_path);
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
            console.log('NamespaceFS: delete_object', file_path);
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
                console.log('NamespaceFS: delete_multiple_objects', file_path);
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
    _get_etag(stat) {
        // IMPORTANT NOTICE - we must return an etag that contains a dash!
        // because this is the criteria of S3 SDK to decide if etag represents md5
        // and perform md5 validation of the data.
        const ident_str = 'inode-' + stat.ino.toString() + '-mtime-' + stat.mtimeMs.toString();
        return ident_str;
    }

    /**
     * @param {string} bucket 
     * @param {string} key 
     * @returns {nb.ObjectInfo}
     */
    _get_object_info(bucket, key, stat) {
        const etag = this._get_etag(stat);
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
            xattr: {},
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
        if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_OBJECT';
        if (err.code === 'EEXIST') err.rpc_code = 'BUCKET_ALREADY_EXISTS';
        if (err.code === 'EPERM' || err.code === 'EACCES') err.rpc_code = 'UNAUTHORIZED';
        return err;
    }

    async _load_bucket(params, fs_account_config) {
        await nb_native().fs.stat(fs_account_config, this.bucket_path);
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
                console.log('NamespaceFS: _delete_object_empty_path skip on unexpected error', err);
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
        const new_dir_path = path.join(params.fs_root_path,
            fs_account_config.new_buckets_path, params.name.unwrap());

        try {
            await nb_native().fs.mkdir(fs_account_config, new_dir_path, get_umasked_mode(0o777));
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async delete_uls(params, object_sdk) {
        const fs_account_config = this.set_cur_fs_account_config(object_sdk);
        const to_delete_dir_path = path.join(params.fs_root_path,
            fs_account_config.new_buckets_path, params.name);

        try {
            const list = await this.list_objects({ ...params, limit: 1 }, object_sdk);

            if (list && list.objects && list.objects.length > 0) {
                const err = new Error('underlying directory has files in it');
                err.rpc_code = 'NOT_EMPTY';
                throw err;
            }

            await this._folder_delete(to_delete_dir_path, fs_account_config);
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }
}

module.exports = NamespaceFS;
