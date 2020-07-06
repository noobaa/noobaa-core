/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const mime = require('mime');
const uuid = require('uuid');
const events = require('events');
const crypto = require('crypto');

const fs_utils = require('../util/fs_utils');
// const fs_xattr = require('fs-xattr');
// const s3_utils = require('../endpoint/s3/s3_utils');
// const stream = require('stream');

// const XATTR_KEY = 'xattr.noobaa.io';

class NamespaceFS {

    constructor({ data_path }) {
        this.data_path = data_path;
    }

    get_write_resource() {
        return this;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {

        if (params.delimiter && params.delimiter !== '/') {
            throw new Error('NamespaceFS: Invalid delimiter ' + params.delimiter);
        }

        await this._load_bucket(params);

        return params.delimiter === '/' ?
            this._list_objects_shallow(params) :
            this._list_objects_deep(params);
    }

    /**
     * @param {object} params 
     * @param {string} params.bucket
     * @param {string} params.prefix
     * @param {string} params.delimiter
     * @param {string} params.key_marker
     * @param {number} params.limit
     */
    async _list_objects_shallow({ bucket, prefix = '', delimiter = '/', key_marker = '', limit = 1000 }) {
        const bucket_root_path = path.join(this.data_path, bucket);
        const prefix_last_pos = prefix.lastIndexOf('/');
        const dir_key = prefix.slice(0, prefix_last_pos + 1);
        const dir_path = path.join(bucket_root_path, dir_key);
        const entry_prefix = prefix.slice(prefix_last_pos + 1);
        const is_marker_in_dir = key_marker.startsWith(dir_key);
        const is_marker_after_dir = (!is_marker_in_dir && key_marker > dir_key);
        const entry_marker = is_marker_in_dir ? key_marker.slice(dir_key.length) : '';
        const entries = is_marker_after_dir ? [] :
            await fs_utils.read_dir_sorted_limit({
                dir_path,
                prefix: entry_prefix,
                marker: entry_marker,
                limit: limit + 1,
            });
        const is_truncated = entries.length > limit;
        const next_marker = is_truncated ?
            dir_key + entries[limit].name :
            undefined;
        const res = {
            objects: [],
            common_prefixes: [],
            is_truncated,
            next_marker,
        };
        let count = 0;
        for (const entry of entries) {
            if (count >= limit) break;
            count += 1;
            const key = dir_key + entry.name;
            if (entry.isDirectory()) {
                res.common_prefixes.push(key + '/');
            } else {
                const stats = await fs.promises.stat(path.join(dir_path, entry.name));
                const obj_info = this._get_object_info(bucket, key, stats);
                res.objects.push(obj_info);
            }
        }
        return res;
    }


    async _list_objects_deep(params) {
        // TODO deep listing
        return this._list_objects_shallow(params);
    }

    // for now we do not support versioning, so returning the same as list objects
    async list_object_versions(params, object_sdk) {
        // return {
        //     objects: [],
        //     common_prefixes: [],
        //     is_truncated: false,
        //     next_marker: undefined,
        //     next_version_id_marker: undefined,
        // };
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

    async read_object_stream(params, object_sdk) {
        try {
            await this._load_bucket(params);
            const file_path = this._get_file_path(params);
            return fs.createReadStream(file_path, {
                start: Number.isInteger(params.start) ? params.start : undefined,
                // end offset for files is inclusive, so need to adjust our exclusive end
                end: Number.isInteger(params.end) ? params.end - 1 : undefined,
            });
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        try {
            await this._load_bucket(params);
            const file_path = this._get_file_path(params);
            const upload_id = uuid.v4();
            const upload_path = path.join(this.data_path, params.bucket, '.noobaa', 'uploads', upload_id);
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
        // for now we do not support listing of multipart uploads
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
            const create_params = JSON.stringify({ ...params, source_stream: null });
            await this._load_multipart(params);
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
            params.multiparts.sort((a, b) => a.num - b.num);
            await this._load_multipart(params);
            const file_path = this._get_file_path(params);
            const upload_path = path.join(params.mpu_path, 'final');
            const upload_stream = fs.createWriteStream(upload_path);
            for (const { num, etag } of params.multiparts) {
                const part_path = path.join(params.mpu_path, `part-${num}`);
                const part_stat = await fs.promises.stat(part_path);
                if (etag !== this._get_etag(part_stat)) {
                    throw new Error('mismatch part etag: ' + util.inspect({ num, etag, part_path, part_stat, params }));
                }
                for await (const data of fs.createReadStream(part_path)) {
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
        await fs_utils.folder_delete(params.mpu_path);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        try {
            await this._load_bucket(params);
            const file_path = this._get_file_path(params);
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
                await fs.promises.unlink(file_path);
            }
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


    //////////////
    // INTERNAL //
    //////////////

    _get_file_path({ bucket, key }) {
        return path.join(this.data_path, bucket, key);
    }

    async _make_path_dirs(file_path) {
        const last_dir_pos = file_path.lastIndexOf('/');
        if (last_dir_pos > 0) return fs_utils.create_path(file_path.slice(0, last_dir_pos));
    }

    _get_etag(stat) {
        const ident_str = 'inode-' + stat.ino.toString() + '-mtime-' + stat.mtime.getTime().toString();
        return crypto.createHash('md5').update(ident_str).digest('hex');
    }

    /**
     * @param {string} bucket 
     * @param {string} key 
     * @param {fs.Stats} stat 
     */
    _get_object_info(bucket, key, stat) {
        const etag = this._get_etag(stat);
        return {
            obj_id: etag,
            bucket,
            key,
            etag,
            size: stat.size,
            create_time: stat.mtime.getTime() + stat.mtimeMs,
            content_type: mime.getType(key) || 'application/octet-stream',
            // temp:
            version_id: 1,
            is_latest: true,
            tag_count: 0,
            delete_marker: false,
            xattr: {},
        };
    }

    _translate_object_error_codes(err) {
        if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_OBJECT';
        return err;
    }

    async _load_bucket(params) {
        try {
            params.bucket_path = path.join(this.data_path, params.bucket);
            await fs.promises.stat(params.bucket_path);
        } catch (err) {
            if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_BUCKET';
            throw err;
        }
    }

    async _load_multipart(params) {
        await this._load_bucket(params);
        const is_new = !params.obj_id;
        if (is_new) {
            params.obj_id = uuid.v4();
        }
        if (!params.mpu_path) {
            params.mpu_path = path.join(params.bucket_path, '.noobaa', 'multipart-uploads', params.obj_id);
        }
        if (is_new) {
            await fs_utils.create_path(params.mpu_path);
        } else {
            try {
                await fs.promises.stat(params.mpu_path);
            } catch (err) {
                if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_UPLOAD';
                throw err;
            }
        }
    }



}


module.exports = NamespaceFS;


/**
 * main implements a simple cli that calls a method of namespace fs
 * and prints the result returned from the async method.
 * 
 * Usage: 
 */
async function main() {
    // eslint-disable-next-line global-require
    require('../util/console_wrapper').original_console();
    // eslint-disable-next-line global-require
    const argv = require('minimist')(process.argv.slice(2));
    const inspect = x => util.inspect(x, { depth: null, breakLength: 10, colors: true });
    argv.data_path = argv.data_path || '.';
    argv.bucket = argv.bucket || 'src';
    argv.prefix = argv.prefix || '';
    argv.key_marker = argv.key_marker || '';
    argv.delimiter = argv.delimiter || '/';
    argv.limit = isNaN(Number(argv.limit)) ? 1000 : Number(argv.limit);
    const op = argv._[0] || 'list_objects';
    console.log(`${op}:\n${inspect(argv)}`);
    const nsfs = new NamespaceFS({ data_path: argv.data_path });
    const res = await (nsfs[op](argv));
    console.log(`Result:\n${inspect(res)}`);
}

if (require.main === module) main();
