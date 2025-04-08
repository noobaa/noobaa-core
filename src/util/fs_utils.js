/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs'); // For createWriteStream
const fsp = require('fs/promises');
const ncp = require('ncp').ncp;
const path = require('path');
const crypto = require('crypto');

const P = require('./promise');
const Semaphore = require('./semaphore');
const os_utils = require('../util/os_utils');

const PRIVATE_DIR_PERMISSIONS = 0o700; // octal 700

/**
 *
 * file_must_not_exist
 *
 */
function file_must_not_exist(file_path) {
    return fsp.stat(file_path)
        .then(function() {
            throw new Error(`${file_path} exists`);
        }, function(err) {
            if (err.code !== 'ENOENT') throw err;
        });
}


/**
 * file_must_exist
 */
async function file_must_exist(file_path) {
    await fsp.stat(file_path);
}

async function file_exists(file_path) {
    try {
        await file_must_exist(file_path);
        return true;
    } catch {
        return false;
    }
}

async function file_not_exists(file_path) {
    try {
        await file_must_not_exist(file_path);
        return true;
    } catch {
        return false;
    }
}

/**
 * options.on_entry - function({path, stat})
 *      returning false from on_entry will stop recursing to entry
 */
async function read_dir_recursive(options) {
    const on_entry = options.on_entry;
    const root = options.root || '.';
    const depth = options.depth || Infinity;
    const level = options.level || 0;
    const dir_sem = options.dir_semaphore || new Semaphore(32);
    options.dir_semaphore = dir_sem;
    const stat_sem = options.stat_semaphore || new Semaphore(128);
    options.stat_semaphore = stat_sem;
    const sub_dirs = [];

    // first step:
    // readdir and stat all entries in this level.
    // run this under semaphores to limit I/O
    // before recurse to sub dirs, we have to free the full list
    // of entries and keep only sub dirs which is usually much less,
    // and release the semaphore too to avoid reentry under acquired sem.

    await dir_sem.surround(async () => {
        if (!level) console.log(`read_dir_recursive: readdir ${root}`);

        const entries = await fsp.readdir(root);

        await Promise.all(entries.map(async entry => {
            const entry_path = path.join(root, entry);
            try {
                const stat = await stat_sem.surround(() => fsp.stat(entry_path));
                if (on_entry) {
                    const res = await on_entry({ path: entry_path, stat });
                    // when on_entry returns explicit false, we stop recursing.
                    if (res === false) return;
                }
                if (stat.isDirectory() && level < depth) {
                    if (stat.size > 64 * 1024 * 1024) {
                        // what to do AAAHH
                        console.error(`read_dir_recursive: huge dir might crash the process ${entry_path}`);
                    }
                    sub_dirs.push(entry_path);
                }
            } catch (err) {
                console.warn(`read_dir_recursive: entry error ${entry_path}:`, err);
            }
        }));
    });

    // second step: recurse to sub dirs

    if (!level) console.log(`read_dir_recursive: recursing ${root} with ${sub_dirs.length} sub dirs`);

    await Promise.all(sub_dirs.map(sub_dir => read_dir_recursive({
        ...options,
        root: sub_dir,
        level: level + 1
    })));

    if (!level) console.log(`read_dir_recursive: finished ${root}`);
}

/**
 * disk_usage
 * @param {string} root dir
 * @returns {Promise<{size: number, count: number}>}
 */
async function disk_usage(root) {
    let size = 0;
    let count = 0;
    await read_dir_recursive({
        root: root,
        on_entry: entry => {
            if (entry.stat.isFile()) {
                size += entry.stat.size;
                count += 1;
            }
        }
    });
    return { size, count };
}


// returns the first line in the file that contains the substring
async function find_line_in_file(file_name, line_sub_string) {
    const data = await fsp.readFile(file_name, 'utf8');
    return data.split('\n')
        .find(line => line.includes(line_sub_string));
}

// returns all lines in the file that contains the substring
async function find_all_lines_in_file(file_name, line_sub_string) {
    const data = await fsp.readFile(file_name, 'utf8');
    return data.split('\n')
        .filter(function(line) {
            return line.includes(line_sub_string);
        });
}

function get_last_line_in_file(file_name) {
    return fsp.readFile(file_name, 'utf8')
        .then(data => {
            const lines = data.split('\n');
            let idx = lines.length - 1;
            while (!lines[idx] && idx > 0) {
                idx -= 1;
            }
            return lines[idx] || undefined;
        });
}

async function create_path(dir, mode) {
    return fsp.mkdir(dir, { mode, recursive: true });
}

async function create_fresh_path(dir, mode) {
    await folder_delete(dir);
    await create_path(dir, mode);
}

function file_copy(src, dst) {
    let cmd;
    if (os_utils.IS_WIN) {
        cmd = 'copy /Y  "' +
            src.replace(/\//g, '\\') + '" "' +
            dst.replace(/\//g, '\\') + '"';
    } else {
        cmd = 'cp -fp ' + src + ' ' + dst;
    }
    console.log('file_copy:', cmd);
    return os_utils.exec(cmd);
}


/**
 * folder_delete deletes a folder
 * @param {string} dir - The directory path to delete
 * @returns {Promise<void>}
 */
async function folder_delete(dir) {
    return fsp.rm(dir, { recursive: true, force: true });
}

async function file_delete(file_name) {
    try {
        await fsp.unlink(file_name);
    } catch (err) {
        ignore_enoent(err);
    }
}

function full_dir_copy(src, dst, filter_regex) {
    return P.fromCallback(callback => {
        ncp.limit = 10;
        const ncp_options = {};
        if (filter_regex) {
            //this regexp will filter out files that matches, except path.
            const ncp_filter_regex = new RegExp(filter_regex);
            const ncp_filter_function = input => {
                if (input.indexOf('/') > 0) {
                    return false;
                } else if (ncp_filter_regex.test(input)) {
                    return false;
                } else {
                    return true;
                }
            };
            ncp_options.filter = ncp_filter_function;
        }
        if (!src || !dst) {
            throw new Error('Both src and dst must be given');
        }
        ncp(src, dst, ncp_options, callback);
    }).then(() => {
        // do nothing. 
    });
}

function tar_pack(tar_file_name, source, ignore_file_changes) {
    let cmd;
    if (os_utils.IS_MAC) {
        cmd = 'tar -zcvf ' + tar_file_name + ' ' + source + '/*';
    } else {
        cmd = 'tar -zcvf ' +
            (ignore_file_changes ? '--warning=no-file-changed ' : '') +
            tar_file_name + ' ' + source + '/*';
    }
    console.log('tar_pack:', cmd);
    return os_utils.exec(cmd);
}

function write_file_from_stream(file_path, read_stream) {
    return new Promise((resolve, reject) => read_stream
        .once('error', reject)
        .pipe(fs.createWriteStream(file_path))
        .once('error', reject)
        .once('finish', resolve)
    );
}

// lock per full file path, to avoid parallel replace to same path, at least from the same process
const process_file_locks = new Map();

/**
 * replace_file is a concurrency-safe way to update the file content
 * the issue with simply doing writeFileAsync is that write is composed from 2 system calls -
 * first truncate to 0 and then write data, and running them concurrently will race and might
 * produce a non stable result. Using rename is a stable way of doing that on most filesystems.
 */
function replace_file(file_path, data) {
    const unique_suffix = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const tmp_name = `${file_path}.${unique_suffix}`;
    const lock_key = path.resolve(file_path);
    if (!process_file_locks.has(lock_key)) {
        process_file_locks.set(lock_key, new Semaphore(1));
    }
    const lock = process_file_locks.get(lock_key);
    return lock.surround(() =>
            P.resolve()
            .then(() => fsp.writeFile(tmp_name, data))
            .then(() => fsp.rename(tmp_name, file_path))
            .catch(err => fsp.unlink(tmp_name)
                .then(() => {
                    throw err;
                })
            )
        )
        .finally(() => {
            if (!lock.length) {
                process_file_locks.delete(lock_key);
            }
        });
}

function ignore_eexist(err) {
    if (err.code !== 'EEXIST') throw err;
}

function ignore_enoent(err) {
    if (err.code !== 'ENOENT') throw err;
}

// EXPORTS
exports.file_must_not_exist = file_must_not_exist;
exports.file_must_exist = file_must_exist;
exports.disk_usage = disk_usage;
exports.read_dir_recursive = read_dir_recursive;
exports.find_line_in_file = find_line_in_file;
exports.find_all_lines_in_file = find_all_lines_in_file;
exports.get_last_line_in_file = get_last_line_in_file;
exports.create_path = create_path;
exports.create_fresh_path = create_fresh_path;
exports.full_dir_copy = full_dir_copy;
exports.file_copy = file_copy;
exports.file_delete = file_delete;
exports.folder_delete = folder_delete;
exports.tar_pack = tar_pack;
exports.write_file_from_stream = write_file_from_stream;
exports.replace_file = replace_file;
exports.ignore_eexist = ignore_eexist;
exports.ignore_enoent = ignore_enoent;
exports.PRIVATE_DIR_PERMISSIONS = PRIVATE_DIR_PERMISSIONS;
exports.file_exists = file_exists;
exports.file_not_exists = file_not_exists;
