/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const fs = require('fs');
const net = require('net');
const path = require('path');
const P = require('../util/promise');
const crypto = require('crypto');
const config = require('../../config');
const RpcError = require('../rpc/rpc_error');
const nb_native = require('../util/nb_native');

const gpfs_link_unlink_retry_err = 'EEXIST';
const gpfs_unlink_retry_catch = 'GPFS_UNLINK_RETRY';
const posix_link_retry_err = 'FS::SafeLink ERROR link target doesn\'t match expected inode and mtime';
const posix_unlink_retry_err = 'FS::SafeUnlink ERROR unlink target doesn\'t match expected inode and mtime';
const VALID_BUCKET_NAME_REGEXP = /^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/;

/** @typedef {import('../util/buffer_utils').MultiSizeBuffersPool} MultiSizeBuffersPool */

// we will use this object to determined the entity for the rpc_code error message 
const entity_enum = Object.freeze({
    OBJECT: 'OBJECT',
    BUCKET: 'BUCKET',
    USER: 'USER',
    ACCESS_KEY: 'ACCESS_KEY',
});

function get_umasked_mode(mode) {
    // eslint-disable-next-line no-bitwise
    return mode & ~config.NSFS_UMASK;
}

async function _make_path_dirs(file_path, fs_context) {
    const last_dir_pos = file_path.lastIndexOf('/');
    if (last_dir_pos > 0) return _create_path(file_path.slice(0, last_dir_pos), fs_context);
}

async function _create_path(dir, fs_context, dir_permissions = config.BASE_MODE_DIR) {
    let dir_path = path.isAbsolute(dir) ? path.sep : '';
    for (const item of dir.split(path.sep)) {
        dir_path = path.join(dir_path, item);
        try {
            await nb_native().fs.mkdir(fs_context, dir_path, get_umasked_mode(dir_permissions));
        } catch (err) {
            const ERR_CODES = ['EISDIR', 'EEXIST'];
            if (!ERR_CODES.includes(err.code)) throw err;
        }
    }
    if (config.NSFS_TRIGGER_FSYNC) await nb_native().fs.fsync(fs_context, dir_path);
}

async function _generate_unique_path(fs_context, tmp_dir_path) {
    const rand_id = crypto.randomUUID();
    const unique_temp_path = path.join(tmp_dir_path, 'lost+found', rand_id);
    await _make_path_dirs(unique_temp_path, fs_context);
    return unique_temp_path;
}


/**
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} bucket_path
 * @param {string} open_path 
 * @param {string} open_mode 
 */
// opens open_path on POSIX, and on GPFS it will open open_path parent folder
async function open_file(fs_context, bucket_path, open_path, open_mode = config.NSFS_OPEN_READ_MODE,
    file_permissions = config.BASE_MODE_FILE) {
    let retries = config.NSFS_MKDIR_PATH_RETRIES;

    const dir_path = path.dirname(open_path);
    const actual_open_path = open_mode === 'wt' ? dir_path : open_path;
    const should_create_path_dirs = (open_mode === 'wt' || open_mode === 'w') && dir_path !== bucket_path;
    for (;;) {
        try {
            if (should_create_path_dirs) {
                dbg.log1(`NamespaceFS._open_file: mode=${open_mode} creating dirs`, open_path, bucket_path);
                await _make_path_dirs(open_path, fs_context);
            }
            dbg.log1(`NamespaceFS._open_file: mode=${open_mode}`, open_path);
            // for 'wt' open the tmpfile with the parent dir path
            const fd = await nb_native().fs.open(fs_context, actual_open_path, open_mode, get_umasked_mode(file_permissions));
            return fd;
        } catch (err) {
            dbg.warn(`native_fs_utils.open_file Retrying retries=${retries} mode=${open_mode} open_path=${open_path} dir_path=${dir_path} actual_open_path=${actual_open_path}`, err);
            if (err.code !== 'ENOENT') throw err;
            // case of concurrennt deletion of the dir_path
            if (retries <= 0 || !should_create_path_dirs) throw err;
            retries -= 1;
        }
    }
}

/**
 * @param {MultiSizeBuffersPool} multi_buffers_pool 
 * @param {nb.NativeFSContext} fs_context 
 * @param {nb.NativeFile} src_file
 * @param {nb.NativeFile} dst_file 
 * @param {number} size 
 * @param {number} write_offset 
 * @param {number} read_offset 
 */
async function copy_bytes(multi_buffers_pool, fs_context, src_file, dst_file, size, write_offset, read_offset) {
    dbg.log1(`Native_fs_utils.copy_bytes size=${size} read_offset=${read_offset} write_offset=${write_offset}`);
    let buffer_pool_cleanup = null;
    try {
        let read_pos = Number(read_offset || 0);
        let bytes_written = 0;
        const total_bytes_to_write = Number(size);
        let write_pos = write_offset >= 0 ? write_offset : 0;
        for (;;) {
            const total_bytes_left = total_bytes_to_write - bytes_written;
            if (total_bytes_left <= 0) break;
            const { buffer, callback } = await multi_buffers_pool.get_buffers_pool(total_bytes_left).get_buffer();
            buffer_pool_cleanup = callback;
            const bytesRead = await src_file.read(fs_context, buffer, 0, buffer.length, read_pos);
            if (!bytesRead) {
                buffer_pool_cleanup = null;
                callback();
                break;
            }
            read_pos += bytesRead;

            let data = buffer.slice(0, bytesRead);
            if (total_bytes_left < bytesRead) data = data.slice(0, total_bytes_left);
            await dst_file.write(fs_context, data, undefined, write_pos);
            write_pos += data.byteLength;
            bytes_written += data.byteLength;
            // Returns the buffer to pool to avoid starvation
            buffer_pool_cleanup = null;
            callback();
        }
    } catch (err) {
        dbg.error('Native_fs_utils.copy_bytes: error - ', err);
        throw err;
    } finally {
        try {
            // release buffer back to pool if needed
            if (buffer_pool_cleanup) buffer_pool_cleanup();
        } catch (err) {
            dbg.warn('Native_fs_utils.copy_bytes file close error', err);
        }
    }
}



/**
 * @param {nb.NativeFSContext} fs_context 
 * @param {nb.NativeFile[]} list_of_files
 */
async function finally_close_files(fs_context, list_of_files = []) {
    await P.map_with_concurrency(5, list_of_files, async file => {
        try {
            if (file) await file.close(fs_context);
        } catch (err) {
            dbg.warn('Native_fs_utils.finally_close_files file close error', err);
        }
    });
}

function _is_gpfs(fs_context) {
    return Boolean(fs_context.backend === 'GPFS' && nb_native().fs.gpfs);
}

async function safe_move(fs_context, src_path, dst_path, src_ver_info, gpfs_options, tmp_dir_path) {
    if (_is_gpfs(fs_context)) {
        await safe_move_gpfs(fs_context, src_path, dst_path, gpfs_options);
    } else {
        await safe_move_posix(fs_context, src_path, dst_path, src_ver_info, tmp_dir_path);
    }
}

async function safe_unlink(fs_context, src_path, src_ver_info, gpfs_options, tmp_dir_path) {
    if (_is_gpfs(fs_context)) {
        const { src_file = undefined, dir_file = undefined } = gpfs_options;
        if (dir_file) {
            await safe_unlink_gpfs(fs_context, src_path, src_file, dir_file);
        } else {
            dbg.error(`safe_unlink: dir_file is ${dir_file}, cannot use it to call safe_unlink_gpfs`);
            throw new Error(`dir_file is ${dir_file}, need a value to safe unlink GPFS`);
        }
    } else {
        await safe_unlink_posix(fs_context, src_path, src_ver_info, tmp_dir_path);
    }
}

async function safe_link(fs_context, src_path, dst_path, src_ver_info, gpfs_options) {
    if (_is_gpfs(fs_context)) {
        const { src_file = undefined, dst_file = undefined } = gpfs_options;
        if (dst_file) {
            await safe_link_gpfs(fs_context, dst_path, src_file, dst_file);
        } else {
            dbg.error(`safe_link: dst_file is ${dst_file}, cannot use it to call safe_link_gpfs`);
            throw new Error(`dst_file is ${dst_file}, need a value to safe link GPFS`);
        }
    } else {
        await safe_link_posix(fs_context, src_path, dst_path, src_ver_info);
    }
}

// this function handles best effort of files move in posix file systems
// 1. safe_link
// 2. safe_unlink
async function safe_move_posix(fs_context, src_path, dst_path, src_ver_info, tmp_dir_path) {
    dbg.log1('Namespace_fs.safe_move_posix', src_path, dst_path, src_ver_info);
    await safe_link_posix(fs_context, src_path, dst_path, src_ver_info);
    await safe_unlink_posix(fs_context, src_path, src_ver_info, tmp_dir_path);
}

// safe_link_posix links src_path to dst_path while verifing dst_path has the expected ino and mtimeNsBigint values
// src_file exists on uploads (open mode = 'w' ) or deletions
// on uploads (open mode 'wt') the dir_file is used as the link source
async function safe_move_gpfs(fs_context, src_path, dst_path, gpfs_options) {
    const { src_file = undefined, dst_file = undefined, dir_file = undefined, should_unlink = false } = gpfs_options;
    dbg.log1('Namespace_fs.safe_move_gpfs', src_path, dst_path, dst_file, should_unlink);
    await safe_link_gpfs(fs_context, dst_path, src_file || dir_file, dst_file);
    if (should_unlink) await safe_unlink_gpfs(fs_context, src_path, src_file, dir_file);
}

// safe_link_posix links src_path to dst_path while verifing dst_path has the expected ino and mtimeNsBigint values
async function safe_link_posix(fs_context, src_path, dst_path, src_version_info) {
    dbg.log1('Namespace_fs.safe_link_posix:', src_path, dst_path, src_version_info);
    await nb_native().fs.safe_link(fs_context, src_path, dst_path, src_version_info.mtimeNsBigint, src_version_info.ino);
}

// 1. create unique temp path
// 2. safe unlink path_to_delete while verifing the file to be deleted has the expected mtimeNsBigint and ino values
async function safe_unlink_posix(fs_context, to_delete_path, to_delete_version_info, tmp_dir_path) {
    dbg.log1('Namespace_fs.safe_unlink_posix:', to_delete_path, to_delete_version_info, tmp_dir_path);
    try {
        const unique_temp_path = await _generate_unique_path(fs_context, tmp_dir_path);
        const { mtimeNsBigint, ino } = to_delete_version_info;
        await nb_native().fs.safe_unlink(fs_context, to_delete_path, unique_temp_path, mtimeNsBigint, ino);
    } catch (err) {
        if (err.code === 'ENOENT') {
            dbg.warn('Namespace_fs.safe_unlink_posix unlink: file already deleted, ignoring..');
            return;
        }
        throw err;
    }
}

/**
 * unlink_ignore_enoent unlinks a file and if recieved an ENOENT error it'll not fail
 * @param {nb.NativeFSContext} fs_context 
 * @param {String} to_delete_path 
 * @returns {Promise<Void>}
 */
async function unlink_ignore_enoent(fs_context, to_delete_path) {
    dbg.log1('native_fs_utils.unlink_ignore_enoent:', to_delete_path);
    try {
        await nb_native().fs.unlink(fs_context, to_delete_path);
    } catch (err) {
        dbg.warn(`native_fs_utils.unlink_ignore_enoent unlink error: file path ${to_delete_path} error`, err, err.code, err.code !== 'EISDIR');
        if (err.code !== 'ENOENT' && err.code !== 'EISDIR') throw err;
        dbg.warn(`native_fs_utils.unlink_ignore_enoent unlink: file ${to_delete_path} already deleted or key is pointing to dir, ignoring..`);
    }
}

// safe_link_gpfs links source_path to dest_path while verifing dest.fd
async function safe_link_gpfs(fs_context, dst_path, src_file, dst_file) {
    const should_not_override = !(dst_file && dst_file.fd);
    dbg.log1('Namespace_fs.safe_link_gpfs source_file:', src_file, src_file.fd, dst_file, dst_file && dst_file.fd, should_not_override);
    await src_file.linkfileat(fs_context, dst_path, dst_file && dst_file.fd, should_not_override);
}

// safe_unlink_gpfs unlinks to_delete_path while verifing to_delete_path.fd
async function safe_unlink_gpfs(fs_context, to_delete_path, to_delete_file, dir_file) {
    dbg.log1('Namespace_fs._delete_version_id unlink:', dir_file, dir_file.fd, to_delete_path, to_delete_file, to_delete_file && to_delete_file.fd);
    try {
        await dir_file.unlinkfileat(fs_context, path.basename(to_delete_path), to_delete_file && to_delete_file.fd);
    } catch (err) {
        if (err.code === 'ENOENT') {
            dbg.warn('Namespace_fs.safe_unlink_gpfs unlink: file already deleted, ignoring..');
            return;
        }
        if (err.code === gpfs_link_unlink_retry_err) err.code = gpfs_unlink_retry_catch;
        throw err;
    }
}

function should_retry_link_unlink(err) {
    const should_retry_general = ['ENOENT', 'EEXIST', 'VERSION_MOVED', 'MISMATCH_VERSION'].includes(err.code);
    const should_retry_gpfs = [gpfs_link_unlink_retry_err, gpfs_unlink_retry_catch].includes(err.code);
    const should_retry_posix = [posix_link_retry_err, posix_unlink_retry_err].includes(err.message);
    return should_retry_general || should_retry_gpfs || should_retry_posix;
}


/**
 * stat_if_exists execute stat on entry_path and ignores on certain error codes.
 * @param {nb.NativeFSContext} fs_context
 * @param {string} entry_path
 * @param {boolean} use_lstat
 * @param {boolean} should_ignore_eacces
 * @returns {Promise<nb.NativeFSStats | undefined>}
 */
async function stat_if_exists(fs_context, entry_path, use_lstat, should_ignore_eacces) {
    try {
        return await nb_native().fs.stat(fs_context, entry_path, { use_lstat });
    } catch (err) {
        // we might want to expand the error list due to permission/structure
        // change (for example: ELOOP, ENAMETOOLONG) or other reason (EPERM) - need to be decided
        if ((err.code === 'EACCES' && should_ignore_eacces) ||
            err.code === 'ENOENT' || err.code === 'ENOTDIR') {
            dbg.log0('stat_if_exists: Could not access file entry_path',
                entry_path, 'error code', err.code, ', skipping...');
        } else {
            throw err;
        }
    }
}

////////////////////////
/// NON CONTAINERIZED //
////////////////////////

function get_config_files_tmpdir() {
    return config.NSFS_TEMP_CONF_DIR_NAME;
}

/**
 * create_config_file created the config file at config_path under schema_dir containig config_data
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} schema_dir
 * @param {string} config_path 
 * @param {string} config_data 
 */
async function create_config_file(fs_context, schema_dir, config_path, config_data) {
    const open_mode = 'w';
    let open_path;
    let upload_tmp_file;
    try {
        // validate config file doesn't exist
        try {
            await nb_native().fs.stat(fs_context, config_path);
            const err = new Error('configuration file already exists');
            err.code = 'EEXIST';
            throw err;
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
        dbg.log1('create_config_file:: config_path:', config_path, 'config_data:', config_data, 'is_gpfs:', open_mode);
        // create config dir if it does not exist
        await _create_path(schema_dir, fs_context, config.BASE_MODE_CONFIG_DIR);

        // open tmp file (in GPFS we open the parent dir using wt open mode)
        const tmp_dir_path = path.join(schema_dir, get_config_files_tmpdir());
        open_path = await _generate_unique_path(fs_context, tmp_dir_path);
        upload_tmp_file = await open_file(fs_context, schema_dir, open_path, open_mode, config.BASE_MODE_CONFIG_FILE);

        // write tmp file data
        await upload_tmp_file.writev(fs_context, [Buffer.from(config_data)], 0);

        dbg.log1('create_config_file:: moving from:', open_path, 'to:', config_path);

        await nb_native().fs.link(fs_context, open_path, config_path);

        dbg.log1('create_config_file:: done', config_path);
    } catch (err) {
        dbg.error('create_config_file:: error', err);
        throw err;
    } finally {
        await finally_close_files(fs_context, [upload_tmp_file]);
        try {
            await nb_native().fs.unlink(fs_context, open_path);
        } catch (error) {
            dbg.log0(`create_config_file:: unlink tmp file failed with error ${error}, skipping`);
        }
    }
}

/**
 * delete_config_file deletes the config file at config_path under schema_dir
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} schema_dir
 * @param {string} config_path 
 */
async function delete_config_file(fs_context, schema_dir, config_path) {
    const is_gpfs = _is_gpfs(fs_context);
    let gpfs_dir_file;
    let gpfs_src_file;
    try {
        // when using GPFS open src and dir file as soon as possible for later unlink validation
        let stat;
        let gpfs_options;
        if (is_gpfs) {
            gpfs_dir_file = await open_file(fs_context, path.dirname(schema_dir), schema_dir, 'r');
            gpfs_src_file = await open_file(fs_context, schema_dir, config_path, 'r');
            gpfs_options = { src_file: gpfs_src_file, dir_file: gpfs_dir_file };
        } else {
            stat = await nb_native().fs.stat(fs_context, config_path);
        }
        dbg.log1('native_fs_utils: delete_config_file config_path:', config_path, 'is_gpfs:', is_gpfs);

        // moving tmp file to config path atomically
        dbg.log1('native_fs_utils: delete_config_file unlinking:', config_path, 'is_gpfs=', is_gpfs);
        const tmp_dir_path = path.join(schema_dir, get_config_files_tmpdir());
        // TODO: add retry? should we fail deletion if the config file was updated at the same time?
        try {
            await safe_unlink(fs_context, config_path, stat, gpfs_options, tmp_dir_path);
        } catch (err) {
            if (err.code === 'ENOENT') {
                dbg.warn(`delete_config_file: config file already deleted ${config_path}`);
                return;
            }
            throw err;
        }
        dbg.log1('native_fs_utils: delete_config_file done', config_path);
    } catch (err) {
        dbg.log1('native_fs_utils: delete_config_file error', err);
        throw err;
    } finally {
        await finally_close_files(fs_context, [gpfs_dir_file, gpfs_src_file]);
    }
}

/**
 * update_config_file updated the config file at config_path under schema_dir with the new config_data
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} schema_dir
 * @param {string} config_path 
 * @param {string} config_data 
 */
async function update_config_file(fs_context, schema_dir, config_path, config_data) {
    const is_gpfs = _is_gpfs(fs_context);
    let upload_tmp_file;
    let gpfs_dst_file;
    try {
        const tmp_dir_path = path.join(schema_dir, get_config_files_tmpdir());

        // when using GPFS open src and dir file as soon as possible for later unlink validation
        let stat;
        let open_path;
        let gpfs_options;
        if (is_gpfs) {
            // when using GPFS open dst file as soon as possible for later linkat validation
            gpfs_dst_file = await open_file(fs_context, schema_dir, config_path, 'r');
            upload_tmp_file = await open_file(fs_context, schema_dir, config_path, 'wt');
            gpfs_options = { dst_file: gpfs_dst_file, dir_file: upload_tmp_file };
            // open path in GPFS is the parent dir 
            open_path = schema_dir;
        } else {
            stat = await nb_native().fs.stat(fs_context, config_path);
            await safe_unlink(fs_context, config_path, stat, undefined, tmp_dir_path);
            open_path = await _generate_unique_path(fs_context, tmp_dir_path);
            upload_tmp_file = await open_file(fs_context, schema_dir, open_path, 'w', config.BASE_MODE_CONFIG_FILE);
        }
        dbg.log1('native_fs_utils: update_config_file config_path:', config_path, 'config_data:', config_data);

        // write tmp file data
        await upload_tmp_file.writev(fs_context, [Buffer.from(config_data)], 0);

        // moving tmp file to config path atomically
        dbg.log1('native_fs_utils: update_config_file moving from:', open_path, 'to:', config_path, 'is_gpfs=', is_gpfs);
        let retries = config.NSFS_RENAME_RETRIES;
        for (;;) {
            try {
                const src_stat = is_gpfs ? undefined : await nb_native().fs.stat(fs_context, open_path);
                await safe_move(fs_context, open_path, config_path, src_stat, gpfs_options, tmp_dir_path);
                dbg.log1('native_fs_utils: update_config_file done', config_path);
                break;
            } catch (err) {
                retries -= 1;
                if (retries <= 0 || !should_retry_link_unlink(err)) throw err;
                dbg.warn(`native_fs_utils.update_config_file: Retrying failed move to dest retries=${retries}` +
                    ` source_path=${open_path} dest_path=${config_path}`, err);
                if (is_gpfs) {
                    await gpfs_dst_file.close(fs_context);
                    gpfs_dst_file = await open_file(fs_context, schema_dir, config_path, 'r');
                }
            }
        }
    } catch (err) {
        dbg.error('native_fs_utils: update_config_file error', err);
        throw err;
    } finally {
        await finally_close_files(fs_context, [upload_tmp_file, gpfs_dst_file]);
    }
}

async function get_user_by_distinguished_name({ distinguished_name }) {
    try {
        if (!distinguished_name) throw new Error('no distinguished name');
        const context = get_process_fs_context();
        const user = await nb_native().fs.getpwname(context, distinguished_name);
        return user;
    } catch (err) {
        dbg.error('native_fs_utils.get_user_by_distinguished_name: failed with error', err, err.code, distinguished_name);
        if (err.code !== undefined) throw err;
        throw new RpcError('NO_SUCH_USER', 'User with distinguished_name not found', err);
    }
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

/**
 * @param {string} [backend]
 * @param {number} [warn_threshold_ms]
 * @param {Function} [report_fs_stats]
 * @returns {nb.NativeFSContext}
 */
function get_process_fs_context(backend = '', warn_threshold_ms = config.NSFS_WARN_THRESHOLD_MS, report_fs_stats = undefined) {
    return {
        uid: process.getuid(),
        gid: process.getgid(),
        warn_threshold_ms,
        backend,
        report_fs_stats
    };
}

/**
 * @param {Object} nsfs_account_config
 * @param {string} [fs_backend]
 * @returns {Promise<nb.NativeFSContext>}
 */
async function get_fs_context(nsfs_account_config, fs_backend) {
    let account_ids_by_dn;
    if (nsfs_account_config.distinguished_name) {
        account_ids_by_dn = await get_user_by_distinguished_name({ distinguished_name: nsfs_account_config.distinguished_name });
    }
    const fs_context = {
        uid: (account_ids_by_dn && account_ids_by_dn.uid) ?? nsfs_account_config.uid,
        gid: (account_ids_by_dn && account_ids_by_dn.gid) ?? nsfs_account_config.gid,
        warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        backend: fs_backend
    };

    //napi does not accepts undefined value for an array. if supplemental_groups is undefined don't include this property at all
    if (nsfs_account_config.supplemental_groups) {
        fs_context.supplemental_groups = nsfs_account_config.supplemental_groups;
    }
    return fs_context;
}

function validate_bucket_creation(params) {
    if (params.name.length < 3 ||
        params.name.length > 63 ||
        net.isIP(params.name) ||
        !VALID_BUCKET_NAME_REGEXP.test(params.name)) {
        throw new RpcError('INVALID_BUCKET_NAME');
    }
}

/**
 * Validate the path param exists or not
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} config_path
 * @param {boolean} use_lstat
 */
async function is_path_exists(fs_context, config_path, use_lstat = false) {
    try {
        await nb_native().fs.stat(fs_context, config_path, { use_lstat });
    } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
    }
    return true;
}

/**
 * is_dir_accessible validate the dir param accessible for read by default
 * if NC_DISABLE_POSIX_MODE_ACCESS_CHECK=false a read and write access check
 * will be executed by checking mode bits 
 * @param {nb.NativeFSContext} fs_context
 * @param {string} dir_path
 * @returns {Promise<boolean>}
 */
/* eslint-disable no-bitwise */
async function is_dir_accessible(fs_context, dir_path) {
    let stat;
    try {
        stat = await nb_native().fs.stat(fs_context, dir_path);
    } catch (err) {
        return false;
    }

    if (config.NC_DISABLE_POSIX_MODE_ACCESS_CHECK) return true;

    const is_owner = fs_context.uid === stat.uid;
    const is_group = fs_context.gid === stat.gid;

    const read_access_owner = stat.mode & fs.constants.S_IRUSR;
    const read_access_group = stat.mode & fs.constants.S_IRGRP;
    const read_access_other = stat.mode & fs.constants.S_IROTH;

    const write_access_owner = stat.mode & fs.constants.S_IWUSR;
    const write_access_group = stat.mode & fs.constants.S_IWGRP;
    const write_access_other = stat.mode & fs.constants.S_IWOTH;

    if (is_owner) {
        return Boolean(read_access_owner && write_access_owner);
    }
    if (is_group) {
        return Boolean(read_access_group && write_access_group);
    }
    return Boolean(read_access_other && write_access_other);
}
/* eslint-enable no-bitwise */

/**
 * delete bucket specific temp folder from bucket storage path, config.NSFS_TEMP_DIR_NAME_<bucket_id>
 * @param {string} dir 
 * @param {nb.NativeFSContext} fs_context
 * @param {boolean} [is_temp]
 * @param {boolean} [silent_if_missing]
 */
async function folder_delete(dir, fs_context, is_temp, silent_if_missing) {
    const exists = await is_path_exists(fs_context, dir);
    if (!exists && is_temp) {
        return;
    }
    const entries = await nb_native().fs.readdir(fs_context, dir);
    const results = await Promise.all(entries.map(entry => {
        const fullPath = path.join(dir, entry.name);
        const task = isDirectory(entry) ? folder_delete(fullPath, fs_context) :
            nb_native().fs.unlink(fs_context, fullPath);
        return task.catch(error => ({ error }));
    }));
    results.forEach(result => {
        // Ignore missing files/directories; bail on other errors
        if (result && result.error && result.error.code !== 'ENOENT') throw result.error;
    });
    try {
        await nb_native().fs.rmdir(fs_context, dir);
    } catch (err) {
        if (err.code === 'ENOENT' && silent_if_missing) {
            dbg.warn(`native_fs_utils.folder_delete already deleted, skipping`);
            return;
        }
        throw err;
    }
}

/**
 * read_file reads file and returns the parsed file data as object
 * @param {nb.NativeFSContext} fs_context
 * @param {string} _path 
 * @return {Promise<object>} 
 */
async function read_file(fs_context, _path) {
    const { data } = await nb_native().fs.readFile(fs_context, _path);
    const data_parsed = JSON.parse(data.toString());
    return data_parsed;
}


/**
 * get_bucket_tmpdir_name returns the bucket tmp dir name
 * @param {string} bucket_id 
 * @returns {string}
 */
function get_bucket_tmpdir_name(bucket_id) {
    return config.NSFS_TEMP_DIR_NAME + '_' + bucket_id;
}


/**
 * get_bucket_tmpdir_full_path returns the bucket tmp dir path
 * @param {string} bucket_path 
 * @param {string} bucket_id 
 * @return {string} 
 */
function get_bucket_tmpdir_full_path(bucket_path, bucket_id) {
    return path.join(bucket_path, get_bucket_tmpdir_name(bucket_id));
}


/**
 * translate_error_codes we translate FS error codes to rpc_codes (strings)
 * and add the rpc_code property to the original error object
 * default rpc_code is internal error
 * @param {object} err
 * @param {('OBJECT'|'BUCKET'|'USER'|'ACCESS_KEY')} entity
 */
function translate_error_codes(err, entity) {
    if (err.rpc_code) return err;
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        err.rpc_code = `NO_SUCH_${entity}`;
    }
    if (err.code === 'EEXIST') err.rpc_code = `${entity}_ALREADY_EXISTS`;
    if (err.code === 'EPERM' || err.code === 'EACCES') err.rpc_code = 'UNAUTHORIZED';
    if (err.code === 'IO_STREAM_ITEM_TIMEOUT') err.rpc_code = 'IO_STREAM_ITEM_TIMEOUT';
    if (err.code === 'INTERNAL_ERROR' || !err.rpc_code) err.rpc_code = 'INTERNAL_ERROR';
    return err;
}

/**
 * lock_and_run acquires a fcntl and calls the given callback after
 * acquiring the lock
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} lock_path
 * @param {Function} cb 
 */
async function lock_and_run(fs_context, lock_path, cb) {
    const lockfd = await nb_native().fs.open(fs_context, lock_path, 'w');

    try {
        await lockfd.fcntllock(fs_context, 'EXCLUSIVE');
        await cb();
    } finally {
        await lockfd.close(fs_context);
    }
}

exports.get_umasked_mode = get_umasked_mode;
exports._make_path_dirs = _make_path_dirs;
exports._create_path = _create_path;
exports._generate_unique_path = _generate_unique_path;
exports.open_file = open_file;
exports.copy_bytes = copy_bytes;
exports.finally_close_files = finally_close_files;
exports.get_user_by_distinguished_name = get_user_by_distinguished_name;
exports.get_config_files_tmpdir = get_config_files_tmpdir;
exports.stat_if_exists = stat_if_exists;

exports._is_gpfs = _is_gpfs;
exports.safe_move = safe_move;
exports.safe_unlink = safe_unlink;
exports.safe_link = safe_link;
exports.safe_move_posix = safe_move_posix;
exports.safe_move_gpfs = safe_move_gpfs;
exports.safe_link_posix = safe_link_posix;
exports.safe_unlink_posix = safe_unlink_posix;
exports.safe_link_gpfs = safe_link_gpfs;
exports.safe_unlink_gpfs = safe_unlink_gpfs;
exports.should_retry_link_unlink = should_retry_link_unlink;
exports.posix_unlink_retry_err = posix_unlink_retry_err;
exports.gpfs_unlink_retry_catch = gpfs_unlink_retry_catch;

exports.create_config_file = create_config_file;
exports.delete_config_file = delete_config_file;
exports.update_config_file = update_config_file;
exports.read_file = read_file;
exports.isDirectory = isDirectory;
exports.get_process_fs_context = get_process_fs_context;
exports.get_fs_context = get_fs_context;
exports.validate_bucket_creation = validate_bucket_creation;
exports.is_path_exists = is_path_exists;
exports.is_dir_accessible = is_dir_accessible;
exports.folder_delete = folder_delete;
exports.unlink_ignore_enoent = unlink_ignore_enoent;
exports.get_bucket_tmpdir_full_path = get_bucket_tmpdir_full_path;
exports.get_bucket_tmpdir_name = get_bucket_tmpdir_name;
exports.entity_enum = entity_enum;
exports.translate_error_codes = translate_error_codes;

exports.lock_and_run = lock_and_run;
