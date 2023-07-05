/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const nb_native = require('../../util/nb_native');
const string_utils = require('../../util/string_utils');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const get_block_internal_dir = require('./block_store_base').get_block_internal_dir;
const { RpcError } = require('../../rpc');
const {
    STORAGE_CLASS_STANDARD,
    STORAGE_CLASS_GLACIER,
    STORAGE_CLASS_GLACIER_IR,
} = require('../../endpoint/s3/s3_utils');

const TMFS_STATE_MIGRATED = 'MIGRATED';
const TMFS_STATE_PREMIGRATED = 'PREMIGRATED';
const TMFS_STATE_RESIDENT = 'RESIDENT';

class BlockStoreFs extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.root_path = options.root_path;
        this.blocks_path_root = path.join(this.root_path, 'blocks_tree');
        this.old_blocks_path = path.join(this.root_path, 'blocks');
        this.config_path = path.join(this.root_path, 'config');
        this.usage_path = path.join(this.root_path, 'usage');

        this.fs_context = {
            disable_ctime_check: config.BLOCK_STORE_FS_TMFS_ENABLED
        };
    }

    async init() {
        // create internal directories to hold blocks by their last 3 hex digits
        // this is done to reduce the number of files in one directory which leads
        // to bad performance
        const num_digits = 3;
        const num_dirs = 16 ** num_digits;
        const dir_list = [];
        for (let i = 0; i < num_dirs; ++i) {
            const dir_str = string_utils.left_pad_zeros(i.toString(16), num_digits) + '.blocks';
            dir_list.push(path.join(this.blocks_path_root, dir_str));
        }
        dir_list.push(path.join(this.blocks_path_root, 'other.blocks'));

        return P.map_with_concurrency(10, dir_list, dir => fs_utils.create_path(dir))
            .then(() => fs.promises.stat(this.usage_path)
                .catch(ignore_not_found)
            )
            .then(stat => {
                if (stat) {
                    return fs.promises.readFile(this.usage_path, 'utf8')
                        .then(data => {
                            this._usage = JSON.parse(data);
                            dbg.log0('found usage file. recovered usage =', this._usage);
                        })
                        .catch(err => {
                            console.error('error while reading usage file:', err);
                            this._usage = null;
                        });
                }
            });
    }

    async get_storage_info() {
        try {
            const [usage, drive] = await Promise.all([
                this._get_usage(),
                os_utils.get_drive_of_path(this.root_path),
            ]);
            const storage = drive.storage;
            storage.used = usage.size;
            const total_unreserved = Math.max(storage.total - config.NODES_FREE_SPACE_RESERVE, 0);
            this.usage_limit = Math.min(total_unreserved, this.storage_limit || Infinity);
            return storage;
        } catch (err) {
            this._test_root_path_exists(err);
        }
    }


    /**
     * @param {nb.BlockMD} block_md
     * @returns {Promise<{ block_md: nb.BlockMD, data: Buffer }>}
     */
    async _read_block(block_md) {
        const fs_context = this.fs_context;
        const block_path = this._get_block_data_path(block_md.id);

        // block_file holds reference to the block file, and is used to close it in case of error.
        let block_file;

        try {
            if (config.BLOCK_STORE_FS_TMFS_ENABLED) {
                block_file = await nb_native().fs.open(fs_context, block_path);
                const stat = await block_file.stat(
                    fs_context,
                    { xattr_get_keys: [config.BLOCK_STORE_FS_XATTR_QUERY_MIGSTAT] }
                );

                const migstat = JSON.parse(stat.xattr[config.BLOCK_STORE_FS_XATTR_QUERY_MIGSTAT] || '{}');

                if (migstat.State === TMFS_STATE_MIGRATED) {
                    // if not yet trying to premigrate, try now.
                    if (migstat.TargetState !== TMFS_STATE_PREMIGRATED) {
                        await block_file.replacexattr(fs_context, {
                            [config.BLOCK_STORE_FS_XATTR_TRIGGER_RECALL]: 'now'
                        });
                    }

                    // if not allowed to read migrated blocks, throw error - temporary fix until
                    // we move to migstat polling.
                    if (!config.BLOCK_STORE_FS_TMFS_ALLOW_MIGRATED_READS) {
                        throw new RpcError('MIGRATED', `block is migrated`);
                    }
                }
            }

            const { data, stat } = await nb_native().fs.readFile(fs_context, block_path, { read_xattr: true });

            // read md from xattr
            let block_md_from_fs = try_parse_block_md(stat.xattr[config.BLOCK_STORE_FS_XATTR_BLOCK_MD]);

            // if not able to parse md from xattr, fallback to reading .meta file content which was the old model.
            if (!block_md_from_fs) {
                try {
                    const meta_path = this._get_block_meta_path(block_md.id);
                    const { data: meta_data } = await nb_native().fs.readFile(fs_context, meta_path);
                    block_md_from_fs = try_parse_block_md(meta_data);
                } catch (err) {
                    // noop
                }
            }

            return { block_md: block_md_from_fs || block_md, data };

        } catch (err) {
            if (err.rpc_code === 'MIGRATED') throw err; // Don't want to catch this error

            this._test_root_path_exists(err);
        } finally {
            if (block_file) await block_file.close(fs_context);
        }
    }

    /**
     * @param {nb.BlockMD} block_md
     * @param {Buffer} data
     * @param {{ ignore_usage?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async _write_block(block_md, data, options) {
        const fs_context = this.fs_context;
        const block_path = this._get_block_data_path(block_md.id);
        const is_test_block = Boolean(options?.ignore_usage);

        const usage = {
            size: block_md.is_preallocated ? 0 : data.length,
            count: block_md.is_preallocated ? 0 : 1,
        };

        // set the block md xattr
        const block_md_to_store = _.pick(block_md, 'id', 'digest_type', 'digest_b64', 'mapping_info');
        const block_md_data = JSON.stringify(block_md_to_store);

        /** @type {nb.NativeFSXattr} */
        const xattr = { [config.BLOCK_STORE_FS_XATTR_BLOCK_MD]: block_md_data };

        // a map of xattrs which will not fail the operation, but only warn
        /** @type {nb.NativeFSXattr} */
        let xattr_try;

        // fsync is needed before actually setting the migrate trigger
        let xattr_need_fsync = false;

        if (!is_test_block) {

            // set xattr to trigger migration of file to underlying tier
            if (config.BLOCK_STORE_FS_TMFS_ENABLED) {
                xattr_try = { [config.BLOCK_STORE_FS_XATTR_TRIGGER_MIGRATE]: 'now' };
                xattr_need_fsync = true;
            }

            // check for existing file and get its size
            const overwrite_stat = await nb_native().fs.stat(fs_context, block_path).catch(ignore_not_found);
            if (overwrite_stat) {
                usage.size -= overwrite_stat.size;
                usage.count -= 1;

                // also make sure we do not leave old .meta files on overwrite
                const meta_path = this._get_block_meta_path(block_md.id);
                const overwrite_meta_stat = await nb_native().fs.stat(fs_context, meta_path).catch(ignore_not_found);
                if (overwrite_meta_stat) {
                    usage.size -= overwrite_meta_stat.size;
                    await nb_native().fs.unlink(fs_context, meta_path).catch(ignore_not_found);
                }
            }
        }

        try {
            await nb_native().fs.writeFile(fs_context, block_path, data, {
                xattr,
                xattr_try,
                xattr_need_fsync,
            });
        } catch (err) {
            this._test_root_path_exists(err);
        }

        if (!is_test_block && (usage.size || usage.count)) {
            this._update_usage(usage);
        }
    }

    async _delete_blocks(block_ids) {
        const succeeded_block_ids = [];
        const failed_block_ids = [];
        await P.map_with_concurrency(10, block_ids, async block_id => {
            try {
                await this._delete_block(block_id);
                succeeded_block_ids.push(block_id);
            } catch (err) {
                // treat ENOENT as success - 
                // this check is already performed inside _delete_block by calling ignore_not_found
                // but just in case something changes we perform it once again here explicitly
                if (err.code === 'ENOENT') {
                    succeeded_block_ids.push(block_id);
                } else {
                    failed_block_ids.push(block_id);
                }
                dbg.warn(`delete block ${block_id} failed due to`, err);
            }
        });
        return { failed_block_ids, succeeded_block_ids };
    }

    async _delete_block(block_id) {
        const fs_context = this.fs_context;
        const block_path = this._get_block_data_path(block_id);
        const meta_path = this._get_block_meta_path(block_id);
        dbg.log1("delete block", block_id);

        const [block_stat, meta_stat] = await Promise.all([
            nb_native().fs.stat(fs_context, block_path).catch(ignore_not_found),
            nb_native().fs.stat(fs_context, meta_path).catch(ignore_not_found),
        ]);

        await Promise.all([
            block_stat && nb_native().fs.unlink(fs_context, block_path).catch(ignore_not_found),
            meta_stat && nb_native().fs.unlink(fs_context, meta_path).catch(ignore_not_found),
        ]);

        if (this._usage && block_stat) {
            const usage = {
                size: -(block_stat.size + ((meta_stat && meta_stat.size) ? meta_stat.size : 0)),
                count: -1
            };
            this._update_usage(usage);
        }
    }


    /**
     * @param {string[]} block_ids
     * @param {string} storage_class
     * @returns {Promise<{ moved_block_ids: string[] }>}
     */
    async _move_blocks_to_storage_class(block_ids, storage_class) {
        if (storage_class === STORAGE_CLASS_GLACIER ||
            storage_class === STORAGE_CLASS_GLACIER_IR) {
            if (config.BLOCK_STORE_FS_TMFS_ENABLED) {
                return this._move_blocks_to_tmfs(block_ids);
            }
        }
        if (storage_class === STORAGE_CLASS_STANDARD) {
            // Nothing to do for now
            return Promise.resolve({ moved_block_ids: [] });
        }

        throw new Error(`unsupported storage class ${storage_class}`);
    }

    /**
     * @param {string[]} block_ids
     * @returns {Promise<{ moved_block_ids: string[] }>}
     */
    async _move_blocks_to_tmfs(block_ids) {
        const moved_block_ids = [];

        await P.map_with_concurrency(10, block_ids, async block_id => {
            try {
                if (await this._move_block_to_tmfs(block_id)) moved_block_ids.push(block_id);
            } catch (err) {
                dbg.warn(`_move_block_to_tmfs block ${block_id} failed due to`, err);
            }
        });

        return { moved_block_ids };
    }

    async _move_block_to_tmfs(block_id) {
        const fs_context = this.fs_context;
        const block_path = this._get_block_data_path(block_id);
        let completed = false;
        let file = null;

        try {
            file = await nb_native().fs.open(fs_context, block_path);
            const stat = await file.stat(fs_context, { xattr_get_keys: [config.BLOCK_STORE_FS_XATTR_QUERY_MIGSTAT] });
            const migstat = JSON.parse(stat?.xattr?.[config.BLOCK_STORE_FS_XATTR_QUERY_MIGSTAT] || '{}');

            // If the block is in PREMIGRATED state or is in RESIDENT state, we need to MIGRATE it back to the
            // tape storage (eviction).
            if (migstat.State === TMFS_STATE_PREMIGRATED || migstat.State === TMFS_STATE_RESIDENT) {
                // it is possible that we requested this in the previous run
                // as well so we need to make sure we do not trigger it again
                if (migstat.TargetState !== TMFS_STATE_MIGRATED) {
                    await file.replacexattr(fs_context, {
                        [config.BLOCK_STORE_FS_XATTR_TRIGGER_MIGRATE]: 'now'
                    });
                }
            } else if (migstat.State === TMFS_STATE_MIGRATED) {
                // If the block is already MIGRATED then return true
                // 
                // It is unlikely that the first call to this function will find the block 
                // in MIGRATED state but next calls might find it in migrated state.
                //
                // The primary caller of this function is TTL BG Worker which WILL call this function
                // more than once for the same block because the tier will not change until this turns true.
                completed = true;
            }
        } catch (err) {
            ignore_not_found(err);
        } finally {
            if (file) await file.close(fs_context);
        }

        return completed;
    }

    _get_usage() {
        return this._usage || this._count_usage();
    }

    async _count_usage() {
        const usage = await fs_utils.disk_usage(this.blocks_path_root);
        dbg.log0('counted disk usage', usage);
        this._usage = usage; // object with properties size and count
        await this._write_usage_internal(); // update the usage file
        return usage;
    }

    _write_usage_internal() {
        return fs_utils.replace_file(this.usage_path, JSON.stringify(this._usage));
    }

    _read_config() {
        return fs.promises.readFile(this.config_path, 'utf8')
            .then(data => JSON.parse(data))
            .catch(ignore_not_found);
    }

    _get_alloc() {
        return this._read_config()
            .then(conf => (conf && conf.alloc) || 0);
    }

    _set_alloc(size) {
        return this._read_config()
            .then(conf => {
                conf = conf || {};
                conf.alloc = size;
                return this._write_config(conf);
            });
    }

    _write_config(conf) {
        const data = JSON.stringify(conf);
        return fs.promises.writeFile(this.config_path, data);
    }

    _get_block_data_path(block_id) {
        const block_dir = get_block_internal_dir(block_id);
        return path.join(this.blocks_path_root, block_dir, block_id + '.data');
    }

    _get_block_meta_path(block_id) {
        const block_dir = get_block_internal_dir(block_id);
        return path.join(this.blocks_path_root, block_dir, block_id + '.meta');
    }

    _get_block_other_path(file) {
        const block_dir = get_block_internal_dir('other');
        return path.join(this.blocks_path_root, block_dir, file);
    }

    _test_root_path_exists(err) {
        if (err.code === 'ENOENT') {
            dbg.error('got ENOENT, checking if root_path exists', err.message);
            if (!fs.existsSync(this.root_path)) {
                throw new RpcError('STORAGE_NOT_EXIST', `could not find the root path ${this.root_path}`);
            }
        }
        throw err;
    }

}

function ignore_not_found(err) {
    if (err.code === 'ENOENT') return;
    throw err;
}

function try_parse_block_md(str) {
    if (str) {
        try {
            return JSON.parse(str);
        } catch (err) {
            // continue...
        }
    }
}

// EXPORTS
exports.BlockStoreFs = BlockStoreFs;
