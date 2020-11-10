/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const config = require('../../../config.js');
const string_utils = require('../../util/string_utils');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const get_block_internal_dir = require('./block_store_base').get_block_internal_dir;
const { RpcError } = require('../../rpc');

class BlockStoreFs extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.root_path = options.root_path;
        this.blocks_path_root = path.join(this.root_path, 'blocks_tree');
        this.old_blocks_path = path.join(this.root_path, 'blocks');
        this.config_path = path.join(this.root_path, 'config');
        this.usage_path = path.join(this.root_path, 'usage');
    }

    init() {
        // create internal directories to hold blocks by their last 3 hex digits
        // this is done to reduce the number of files in one directory which leads
        // to bad performance
        const num_digits = 3;
        const num_dirs = 16 ** num_digits;
        const dir_list = [];
        for (let i = 0; i < num_dirs; ++i) {
            let dir_str = string_utils.left_pad_zeros(i.toString(16), num_digits) + '.blocks';
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

    get_storage_info() {
        return Promise.all([
                this._get_usage(),
                os_utils.get_drive_of_path(this.root_path)
                .catch(err => {
                    dbg.error('got error from get_drive_of_path. checking if root_path exists', err.message);
                    this._test_root_path_exists();
                    throw err;
                })
            ])
            .then(([usage, drive]) => {
                const storage = drive.storage;
                storage.used = usage.size;
                const total_unreserved = Math.max(storage.total - config.NODES_FREE_SPACE_RESERVE, 0);
                this.usage_limit = Math.min(total_unreserved, this.storage_limit || Infinity);
                return storage;
            });
    }

    _test_root_path_exists() {
        if (!fs.existsSync(this.root_path)) {
            throw new RpcError('STORAGE_NOT_EXIST', `could not find the root path ${this.root_path}`);
        }
    }

    _read_block(block_md) {
        const block_path = this._get_block_data_path(block_md.id);
        const meta_path = this._get_block_meta_path(block_md.id);
        dbg.log1('fs read block', block_path);
        return Promise.all([
                fs.promises.readFile(block_path),
                fs.promises.readFile(meta_path),
            ])
            .then(([data_file, meta_file]) => ({
                block_md: block_md,
                data: data_file,
            }))
            .catch(err => {
                if (err.code === 'ENOENT') {
                    dbg.error('got error when reading', block_md, '. checking if root_path exists', err.message);
                    this._test_root_path_exists();
                }
                throw err;
            });
    }

    _write_block(block_md, data) {
        let overwrite_stat;
        let md_overwrite_stat;
        const block_path = this._get_block_data_path(block_md.id);
        const meta_path = this._get_block_meta_path(block_md.id);
        const block_md_to_store = _.pick(block_md, 'id', 'digest_type', 'digest_b64');
        const block_md_data = JSON.stringify(block_md_to_store);

        return Promise.resolve()
            .then(() => fs.promises.stat(block_path))
            .catch(ignore_not_found)
            .then(stat => {
                overwrite_stat = stat;
                dbg.log1('_write_block', block_path, data.length, overwrite_stat);
                // create/replace the block on fs
                return Promise.all([
                    fs.promises.writeFile(block_path, data),
                    fs.promises.writeFile(meta_path, block_md_data),
                ]);
            })
            .catch(err => {
                if (err.code === 'ENOENT') {
                    dbg.error('got error when writing', block_md, '. checking if root_path exists', err.message);
                    this._test_root_path_exists();
                }
                throw err;
            })
            .then(() => {
                if (overwrite_stat) {
                    return fs.promises.stat(meta_path).catch(ignore_not_found)
                        .then(md_stat => {
                            md_overwrite_stat = md_stat;
                        });
                }
            })
            .then(() => {
                let overwrite_size = 0;
                let overwrite_count = 0;
                if (overwrite_stat) {
                    overwrite_size = overwrite_stat.size + (md_overwrite_stat ?
                        md_overwrite_stat.size : 0);
                    overwrite_count = 1;
                }
                let size = (block_md.is_preallocated ? 0 : data.length) + block_md_data.length - overwrite_size;
                let count = (block_md.is_preallocated ? 0 : 1) - overwrite_count;
                if (size || count) this._update_usage({ size, count });
            });
    }

    _write_usage_internal() {
        return fs_utils.replace_file(this.usage_path, JSON.stringify(this._usage));
    }


    _delete_blocks(block_ids) {
        let failed_to_delete_block_ids = [];
        return P.map_with_concurrency(10, block_ids, block_id =>
                this._delete_block(block_id)
                .catch(err => {
                    // This check is already performed inside _delete_block by calling ignore_not_found
                    // but just in case something changes we perform it once again here explicitly
                    if (err.code !== 'ENOENT') {
                        failed_to_delete_block_ids.push(block_id);
                    }
                    // TODO handle failed deletions - report to server and reclaim later
                    dbg.warn('delete block failed due to', err);
                })
            )
            .then(() => ({
                failed_block_ids: failed_to_delete_block_ids,
                succeeded_block_ids: _.difference(block_ids, failed_to_delete_block_ids)
            }));
    }

    _delete_block(block_id) {
        const block_path = this._get_block_data_path(block_id);
        const meta_path = this._get_block_meta_path(block_id);
        let del_stat;
        let md_del_stat;
        dbg.log1("delete block", block_id);
        return Promise.all([
                fs.promises.stat(block_path)
                .catch(ignore_not_found)
                .then(stat => {
                    del_stat = stat;
                    return fs.promises.unlink(block_path).catch(ignore_not_found);
                }),
                fs.promises.stat(meta_path)
                .catch(ignore_not_found)
                .then(stat => {
                    md_del_stat = stat;
                    return fs.promises.unlink(meta_path).catch(ignore_not_found);
                })
            ])
            .then(() => {
                if (this._usage && del_stat) {
                    let usage = {
                        size: -(del_stat.size + ((md_del_stat && md_del_stat.size) ? md_del_stat.size : 0)),
                        count: -1
                    };
                    return this._update_usage(usage);
                }
            });
    }

    _get_usage() {
        return this._usage || this._count_usage();
    }

    _count_usage() {
        return fs_utils.disk_usage(this.blocks_path_root)
            .then(usage => {
                dbg.log0('counted disk usage', usage);
                this._usage = usage; // object with properties size and count
                // update usage file
                let usage_data = JSON.stringify(this._usage);
                return fs.promises.writeFile(this.usage_path, usage_data)
                    .then(() => usage);
            });
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
        let block_dir = get_block_internal_dir(block_id);
        return path.join(this.blocks_path_root, block_dir, block_id + '.data');
    }

    _get_block_meta_path(block_id) {
        let block_dir = get_block_internal_dir(block_id);
        return path.join(this.blocks_path_root, block_dir, block_id + '.meta');
    }

    _get_block_other_path(file) {
        let block_dir = get_block_internal_dir('other');
        return path.join(this.blocks_path_root, block_dir, file);
    }

}

function ignore_not_found(err) {
    if (err.code === 'ENOENT') return;
    throw err;
}

// EXPORTS
exports.BlockStoreFs = BlockStoreFs;
