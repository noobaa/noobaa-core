/**
 *
 * BLOCK STORE FS
 *
 */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const uuid = require('node-uuid');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const fs_utils = require('../util/fs_utils');
const os_utils = require('../util/os_utils');
const string_utils = require('../util/string_utils');
const promise_utils = require('../util/promise_utils');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;

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
        const num_dirs = Math.pow(16, num_digits);
        const dir_list = [];
        for (let i = 0; i < num_dirs; ++i) {
            let dir_str = string_utils.left_pad_zeros(i.toString(16), num_digits) + '.blocks';
            dir_list.push(path.join(this.blocks_path_root, dir_str));
        }
        dir_list.push(path.join(this.blocks_path_root, 'other.blocks'));

        return P.map(dir_list, dir => fs_utils.create_path(dir), {
                concurrency: 10
            })
            .then(() => this._upgrade_to_blocks_tree())
            .then(() => fs.statAsync(this.usage_path)).catch(ignore_not_found)
            .then(stat => {
                if (stat) {
                    return fs.readFileAsync(this.usage_path)
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
        return P.join(
                this._get_usage(),
                os_utils.get_drive_of_path(this.root_path))
            .spread((usage, drive) => {
                const storage = drive.storage;
                storage.used = usage.size;
                return storage;
            });
    }

    _read_block(block_md) {
        const block_path = this._get_block_data_path(block_md.id);
        const meta_path = this._get_block_meta_path(block_md.id);
        dbg.log1('fs read block', block_path);
        return P.join(
                fs.readFileAsync(block_path),
                fs.readFileAsync(meta_path))
            .spread((data_file, meta_file) => {
                return {
                    block_md: block_md,
                    data: data_file,
                };
            });
    }

    _write_block(block_md, data) {
        let overwrite_stat;
        const block_path = this._get_block_data_path(block_md.id);
        const meta_path = this._get_block_meta_path(block_md.id);
        const block_md_to_store = _.pick(block_md, 'id', 'digest_type', 'digest_b64');
        const block_md_data = JSON.stringify(block_md_to_store);


        return P.fcall(() => fs.statAsync(block_path).catch(ignore_not_found))
            .then(stat => {
                overwrite_stat = stat;
                dbg.log1('_write_block', block_path, data.length, overwrite_stat);
                // create/replace the block on fs
                return P.join(
                    fs.writeFileAsync(block_path, data),
                    fs.writeFileAsync(meta_path, block_md_data));
            })
            .then(() => {
                let overwrite_size = 0;
                let overwrite_count = 0;
                if (overwrite_stat) {
                    overwrite_size = overwrite_stat.size;
                    overwrite_count = 1;
                }
                let usage = {
                    size: data.length + block_md_data.length - overwrite_size,
                    count: 1 - overwrite_count
                };
                return this._update_usage(usage);
            });
    }

    _update_usage(usage) {
        if (this._usage) {
            this._usage.size += usage.size;
            this._usage.count += usage.count;

            if (this.update_usage_work_item) return;
            const UPDATE_INTERVAL = 3000;
            // perform updates at most once every UPDATE_INTERVAL ms
            this.update_usage_work_item = setTimeout(() => {
                let usage_data = JSON.stringify(this._usage);
                let tmp_usage_path = this.usage_path + uuid();
                //write to a temp file and then move to usage file to make it
                fs.writeFileAsync(tmp_usage_path, usage_data)
                    .then(() => {
                        this.update_usage_work_item = null;
                        return fs.renameAsync(tmp_usage_path, this.usage_path);
                    });
            }, UPDATE_INTERVAL);
        }
    }

    _delete_blocks(block_ids) {
        return P.map(block_ids,
            block_id => this._delete_block(block_id)
            .catch(err => {
                // TODO handle failed deletions - report to server and reclaim later
                dbg.warn('delete block failed due to', err);
            }), {
                // limit concurrency with semaphore
                concurrency: 10
            });
    }

    _delete_block(block_id) {
        const block_path = this._get_block_data_path(block_id);
        const meta_path = this._get_block_meta_path(block_id);
        let del_stat;

        dbg.log("delete block", block_id);
        return fs.statAsync(block_path).catch(ignore_not_found)
            .then(stat => {
                del_stat = stat;
                return P.join(
                    fs.unlinkAsync(block_path).catch(ignore_not_found),
                    fs.unlinkAsync(meta_path).catch(ignore_not_found));
            })
            .then(() => {
                if (this._usage && del_stat) {
                    let usage = {
                        size: -del_stat.size,
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
                return fs.writeFileAsync(this.usage_path, usage_data).return(usage);
            });
    }

    _read_config() {
        return fs.readFileAsync(this.config_path)
            .catch(ignore_not_found)
            .then(data => JSON.parse(data));
    }

    _get_alloc() {
        return this._read_config()
            .then(config => config && config.alloc || 0);
    }

    _set_alloc(size) {
        return this._read_config()
            .then(config => {
                config = config || {};
                config.alloc = size;
                return this._write_config(config);
            });
    }

    _write_config(config) {
        const data = JSON.stringify(config);
        return fs.writeFileAsync(this.config_path, data);
    }

    _get_block_data_path(block_id) {
        let block_dir = this._get_block_internal_dir(block_id);
        return path.join(this.blocks_path_root, block_dir, block_id + '.data');
    }

    _get_block_meta_path(block_id) {
        let block_dir = this._get_block_internal_dir(block_id);
        return path.join(this.blocks_path_root, block_dir, block_id + '.meta');
    }

    _get_block_other_path(file) {
        let block_dir = this._get_block_internal_dir('other');
        return path.join(this.blocks_path_root, block_dir, file);
    }

    _upgrade_to_blocks_tree() {
        return fs.statAsync(this.old_blocks_path)
            .catch(err => {
                // when it doesn't exist it means we don't need to upgrade
                // on any other error, we ignore as we don't really expect
                // any error we have anything to do about it
                if (err.code !== 'ENOENT') {
                    dbg.log0('_upgrade_to_blocks_tree:',
                        'Old blocks dir failed to stat, ignoring',
                        this.old_blocks_path, err);
                }
            })
            .then(stat => {
                if (!stat) return;
                if (stat.size > 64 * 1024 * 1024) {
                    dbg.warn('_upgrade_to_blocks_tree:',
                        'Old blocks dir is huge and might crash the process',
                        'spawning upgrade_agent_to_blocks_tree.py to the rescue',
                        this.old_blocks_path, stat);
                    // spawning the python script to iterativly move
                    // the large blocks to blocks tree.
                    // the output of the script will be redirected to our stdout
                    // though this will not be logged through our debug module,
                    // but still collected in diagnostics.
                    return promise_utils.spawn('python', [
                        'src/agent/upgrade_agent_to_blocks_tree.py',
                        '--wet',
                        this.root_path
                    ]);
                }
                if (stat.size > 8 * 1024 * 1024) {
                    dbg.warn('_upgrade_to_blocks_tree:',
                        'Old blocks dir is pretty big and might take longer to read',
                        this.old_blocks_path, stat);
                }
                return this._move_to_blocks_tree();
            });
    }

    _move_to_blocks_tree() {
        let num_move_errors = 0;
        dbg.log0('_upgrade_to_blocks_tree: reading', this.old_blocks_path);
        return fs.readdirAsync(this.old_blocks_path)
            .then(files => {
                dbg.log2('found', files.length, 'files to move. files:', files);
                return P.map(files, file => {
                    let file_split = file.split('.');
                    let new_path = this._get_block_other_path(file);
                    if (file_split.length === 2) {
                        let block_id = file_split[0];
                        let suffix = file_split[1];
                        if (suffix === 'data') {
                            new_path = this._get_block_data_path(block_id);
                        } else if (suffix === 'meta') {
                            new_path = this._get_block_meta_path(block_id);
                        }
                    }
                    let old_path = path.join(this.old_blocks_path, file);
                    return fs.renameAsync(old_path, new_path)
                        .catch(err => {
                            // we log the error here and count, but do not throw
                            // to try and move all the rest of the files.
                            num_move_errors += 1;
                            dbg.error('_upgrade_to_blocks_tree:',
                                'failed moving', old_path, '->', new_path, err);
                        });
                }, {
                    // limit the number of promises to use for moving blocks
                    // - set arbitrarily for now
                    concurrency: 10
                });
            })
            .then(() => fs.rmdirAsync(this.old_blocks_path))
            .then(() => {
                // since we also successfuly deleted the old blocks dir
                // it must mean there are no leftovers in anycase.
                // so even if we counted num_move_errors, it might have been
                // due to parallel operations with another process,
                // so we ignore it.
                if (num_move_errors) {
                    dbg.log0('_upgrade_to_blocks_tree: finished', this.old_blocks_path,
                        'eventhough we had num_move_errors', num_move_errors);
                }
                dbg.log0('_upgrade_to_blocks_tree: done', this.old_blocks_path);
            })
            .catch(err => {
                dbg.error('_upgrade_to_blocks_tree: failed',
                    this.old_blocks_path, 'num_move_errors', num_move_errors,
                    err.stack || err);
            });
    }

}

function ignore_not_found(err) {
    if (err.code === 'ENOENT') return;
    throw err;
}

// EXPORTS
exports.BlockStoreFs = BlockStoreFs;
