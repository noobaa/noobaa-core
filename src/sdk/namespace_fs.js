/* Copyright (C) 2020 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const mime = require('mime');
const events = require('events');
const { v4: uuidv4 } = require('uuid');

const config = require('../../config');
const s3_utils = require('../endpoint/s3/s3_utils');
const fs_utils = require('../util/fs_utils');
const stream_utils = require('../util/stream_utils');
const buffer_utils = require('../util/buffer_utils');
const LRUCache = require('../util/lru_cache');
const Semaphore = require('../util/semaphore');

const buffers_pool_sem = new Semaphore(config.NSFS_BUF_POOL_MEM_LIMIT);
const buffers_pool = new buffer_utils.BuffersPool(config.NSFS_BUF_SIZE, buffers_pool_sem);

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
 * @type {LRUCache<string, string, ReaddirCacheItem>}
 */
const dir_cache = new LRUCache({
    name: 'nsfs-dir-cache',
    load: async dir_path => {
        const time = Date.now();
        const stat = await fs.promises.stat(dir_path);
        let sorted_entries;
        let usage = config.NSFS_DIR_CACHE_MIN_DIR_SIZE;
        if (stat.size <= config.NSFS_DIR_CACHE_MAX_DIR_SIZE) {
            sorted_entries = await fs.promises.readdir(dir_path, { withFileTypes: true });
            sorted_entries.sort(sort_entries_by_name);
            for (const ent of sorted_entries) {
                usage += ent.name.length + 4;
            }
        }
        return { time, stat, sorted_entries, usage };
    },
    validate: async ({ stat }, dir_path) => {
        const new_stat = await fs.promises.stat(dir_path);
        return (new_stat.ino === stat.ino && new_stat.mtime.getTime() === stat.mtime.getTime());
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
     *  fs_root: string;
     * }} params
     */
    constructor({ fs_root }) {
        this.fs_root = fs_root;
    }

    get_write_resource() {
        return this;
    }

    get_bucket(bucket) {
        return bucket;
    }

    is_same_namespace(other) {
        // in noobaa namespace case just check that other is also same fs
        return other instanceof NamespaceFS && other.fs_root === this.fs_root;
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
     *  bucket_path?: string, // see _load_bucket()
     * }} ListParams
     */

    /**
     * @param {ListParams} params 
     */
    async list_objects(params, object_sdk) {

        await this._load_bucket(params);

        const {
            bucket,
            bucket_path,
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

            /** @type {fs.Dir} */
            let dir_handle;

            /** @type {ReaddirCacheItem} */
            let cached_dir;

            const dir_path = path.join(bucket_path, dir_key);

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
                    ent.name === config.NSFS_TEMP_DIR_NAME) {
                    return;
                }

                const r = {
                    key: this._get_entry_key(dir_key, ent),
                    common_prefix: ent.isDirectory(),
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
                cached_dir = await dir_cache.get_with_cache(dir_path);
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
                dir_handle = await fs.promises.opendir(dir_path, { bufferSize: 128 });
                for await (const ent of dir_handle) {
                    await process_entry(ent);
                    // since we dir entries streaming order is not sorted,
                    // we have to keep scanning all the keys before we can stop.
                }
            } finally {
                if (dir_handle) {
                    try {
                        console.warn('NamespaceFS: close dir streaming', dir_path, 'size', cached_dir.stat.size);
                        await dir_handle.close();
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
            const entry_path = path.join(bucket_path, r.key);
            r.stat = await fs.promises.stat(entry_path);
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
            await this._load_bucket(params);
            const file_path = this._get_file_path(params);
            const stat = await fs.promises.stat(file_path);
            console.log(file_path, stat);
            return this._get_object_info(params.bucket, params.key, stat);
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    /*
    async read_object_stream_SLOW(params, object_sdk, res) {
        try {
            await this._load_bucket(params);
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
        try {
            await this._load_bucket(params);
            const file_path = this._get_file_path(params);
            file = await fs.promises.open(file_path, fs.constants.O_RDONLY);

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
                const { bytesRead } = await file.read(buffer, 0, read_size, pos);
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
                if (file) await file.close();
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
        try {
            await this._load_bucket(params);
            const file_path = this._get_file_path(params);
            const upload_id = uuidv4();
            const upload_path = path.join(params.bucket_path, config.NSFS_TEMP_DIR_NAME, 'uploads', upload_id);
            // console.log('NamespaceFS.upload_object:', upload_path, '->', file_path);
            await Promise.all([this._make_path_dirs(file_path), this._make_path_dirs(upload_path)]);
            await this._upload_stream(params.source_stream, upload_path);
            // TODO use file xattr to store md5_b64 xattr, etc.
            const stat = await fs.promises.stat(upload_path);
            await fs.promises.rename(upload_path, file_path);
            return { etag: this._get_etag(stat) };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async _upload_stream(source_stream, upload_path, write_options) {
        return new Promise((resolve, reject) =>
            source_stream
            .once('error', reject)
            .pipe(
                fs.createWriteStream(upload_path, write_options)
                .once('error', reject)
                .once('finish', resolve)
            )
        );
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
            await this._load_bucket(params);
            params.obj_id = uuidv4();
            params.mpu_path = this._mpu_path(params);
            await fs_utils.create_path(params.mpu_path);
            const create_params = JSON.stringify({ ...params, source_stream: null });
            await fs.promises.writeFile(path.join(params.mpu_path, 'create_object_upload'), create_params);
            return { obj_id: params.obj_id };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async upload_multipart(params, object_sdk) {
        try {
            await this._load_multipart(params);
            const upload_path = path.join(params.mpu_path, `part-${params.num}`);
            await this._upload_stream(params.source_stream, upload_path);
            const stat = await fs.promises.stat(upload_path);
            return { etag: this._get_etag(stat) };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async list_multiparts(params, object_sdk) {
        await this._load_multipart(params);
        const entries = await fs.promises.readdir(params.mpu_path);
        const multiparts = await Promise.all(
            entries
            .filter(e => e.startsWith('part-'))
            .map(async e => {
                const num = Number(e.slice('part-'.length));
                const part_path = path.join(params.mpu_path, e);
                const stat = await fs.promises.stat(part_path);
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
    }

    async complete_object_upload(params, object_sdk) {
        try {
            const { multiparts = [] } = params;
            multiparts.sort((a, b) => a.num - b.num);
            await this._load_multipart(params);
            const file_path = this._get_file_path(params);
            const upload_path = path.join(params.mpu_path, 'final');
            const upload_stream = fs.createWriteStream(upload_path);
            for (const { num, etag } of multiparts) {
                const part_path = path.join(params.mpu_path, `part-${num}`);
                const part_stat = await fs.promises.stat(part_path);
                if (etag !== this._get_etag(part_stat)) {
                    throw new Error('mismatch part etag: ' +
                        util.inspect({ num, etag, part_path, part_stat, params }));
                }
                for await (const data of fs.createReadStream(part_path, {
                    highWaterMark: config.NSFS_BUF_SIZE,
                })) {
                    if (!upload_stream.write(data)) {
                        await events.once(upload_stream, 'drain');
                    }
                }
            }
            upload_stream.end();
            const stat = await fs.promises.stat(upload_path);
            await fs.promises.rename(upload_path, file_path);
            await fs_utils.folder_delete(params.mpu_path);
            return { etag: this._get_etag(stat) };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async abort_object_upload(params, object_sdk) {
        await this._load_multipart(params);
        console.log('NamespaceFS: abort_object_upload', params.mpu_path);
        await fs_utils.folder_delete(params.mpu_path);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        try {
            await this._load_bucket(params);
            const file_path = this._get_file_path(params);
            console.log('NamespaceFS: delete_object', file_path);
            await fs.promises.unlink(file_path);
            return {};
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async delete_multiple_objects(params, object_sdk) {
        try {
            await this._load_bucket(params);
            for (const { key } of params.objects) {
                const file_path = this._get_file_path({ bucket: params.bucket, key });
                console.log('NamespaceFS: delete_multiple_objects', file_path);
                await fs.promises.unlink(file_path);
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

    _get_file_path({ bucket, key }) {
        const p = path.join(this.fs_root, bucket, key);
        return p.endsWith('/') ? p + config.NSFS_FOLDER_OBJECT_NAME : p;
    }

    /**
     * @param {string} dir_key 
     * @param {fs.Dirent} ent 
     * @returns {string} 
     */
    _get_entry_key(dir_key, ent) {
        if (ent.name === config.NSFS_FOLDER_OBJECT_NAME) return dir_key;
        return dir_key + ent.name + (ent.isDirectory() ? '/' : '');
    }

    async _make_path_dirs(file_path) {
        const last_dir_pos = file_path.lastIndexOf('/');
        if (last_dir_pos > 0) return fs_utils.create_path(file_path.slice(0, last_dir_pos));
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
     * @param {fs.Stats} stat
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
        return err;
    }

    async _load_bucket(params) {
        try {
            params.bucket_path = path.join(this.fs_root, params.bucket);
            await fs.promises.stat(params.bucket_path);
        } catch (err) {
            if (err.code === 'ENOENT') {
                // err.rpc_code = 'NO_SUCH_BUCKET';

                // Instead of returning NO_SUCH_BUCKET we create the bucket dir.
                // TODO should verify bucket exists in the system?
                // or was it verified already for the request?

                await fs_utils.create_path(params.bucket_path);
                return;
            }
            throw err;
        }
    }

    _mpu_path(params) {
        return path.join(
            params.bucket_path,
            config.NSFS_TEMP_DIR_NAME,
            'multipart-uploads',
            params.obj_id
        );
    }
    async _load_multipart(params) {
        await this._load_bucket(params);
        params.mpu_path = this._mpu_path(params);
        try {
            await fs.promises.stat(params.mpu_path);
        } catch (err) {
            if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_UPLOAD';
            throw err;
        }
    }

}

module.exports = NamespaceFS;
