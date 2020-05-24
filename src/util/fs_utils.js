/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const ncp = require('ncp').ncp;
const path = require('path');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const crypto = require('crypto');

const P = require('./promise');
const Semaphore = require('./semaphore');
const promise_utils = require('./promise_utils');
const get_folder_size = P.promisify(require('get-folder-size'));

const is_windows = (process.platform === "win32");
const is_mac = (process.platform === "darwin");

const PRIVATE_DIR_PERMISSIONS = 0o700; // octal 700

/**
 *
 * file_must_not_exist
 *
 */
function file_must_not_exist(file_path) {
    return fs.statAsync(file_path)
        .then(function() {
            throw new Error(`${file_path} exists`);
        }, function(err) {
            if (err.code !== 'ENOENT') throw err;
        });
}


/**
 *
 * file_must_exist
 *
 */
function file_must_exist(file_path) {
    return fs.statAsync(file_path).return();
}


async function file_exists(file_path) {
    try {
        await file_must_exist(file_path);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * options.on_entry - function({path, stat})
 *      returning false from on_entry will stop recursing to entry
 */
function read_dir_recursive(options) {
    const on_entry = options.on_entry;
    const root = options.root || '.';
    const depth = options.depth || Infinity;
    const level = options.level || 0;
    const dir_sem = options.dir_semaphore || new Semaphore(32);
    options.dir_semaphore = dir_sem;
    const stat_sem = options.stat_semaphore || new Semaphore(128);
    options.stat_semaphore = stat_sem;
    const sub_dirs = [];

    return dir_sem.surround(() => {
            // first step:
            // readdir and stat all entries in this level.
            // run this under semaphores to limit I/O
            // before recurse to sub dirs, we have to free the full list
            // of entries and keep only sub dirs which is usually much less,
            // and release the semaphore too to avoid reentry under acquired sem.
            if (!level) {
                console.log('read_dir_recursive: readdir', root);
            }
            return fs.readdirAsync(root)
                .map(entry => {
                    const entry_path = path.join(root, entry);
                    let stat;
                    return stat_sem.surround(() => fs.statAsync(entry_path))
                        .then(stat_arg => {
                            stat = stat_arg;
                            return on_entry && on_entry({
                                path: entry_path,
                                stat: stat
                            });
                        })
                        .then(res => {
                            // when on_entry returns false, we stop recursing.
                            if (res === false) return;
                            if (stat.isDirectory() && level < depth) {
                                if (stat.size > 64 * 1024 * 1024) {
                                    console.error('read_dir_recursive:',
                                        'dir is huge and might crash the process',
                                        entry_path);
                                    // what to do AAAHH
                                }
                                sub_dirs.push(entry_path);
                            }
                        })
                        .catch(err => {
                            console.warn('read_dir_recursive:',
                                'entry error', entry_path, err);
                        });
                })
                .return();
        })
        .then(() => {
            // second step: recurse to sub dirs
            if (!level) {
                console.log('read_dir_recursive: recursing', root,
                    'with', sub_dirs.length, 'sub dirs');
            }
            return P.map(sub_dirs, sub_dir =>
                read_dir_recursive(_.extend(options, {
                    root: sub_dir,
                    level: level + 1,
                })));
        })
        .then(() => {
            if (!level) {
                console.log('read_dir_recursive: finished', root);
            }
        });
}

/**
 *
 * disk_usage
 *
 */
function disk_usage(root) {
    let size = 0;
    let count = 0;
    return read_dir_recursive({
            root: root,
            on_entry: entry => {
                if (entry.stat.isFile()) {
                    size += entry.stat.size;
                    count += 1;
                }
            }
        })
        .then(() => ({
            size: size,
            count: count,
        }));
}


// returns the first line in the file that contains the substring
function find_line_in_file(file_name, line_sub_string) {
    return fs.readFileAsync(file_name, 'utf8')
        .then(data => data.split('\n')
            .find(line => line.indexOf(line_sub_string) > -1));
}

// returns all lines in the file that contains the substring
function find_all_lines_in_file(file_name, line_sub_string) {
    return fs.readFileAsync(file_name, 'utf8')
        .then(data => data.split('\n')
            .filter(function(line) {
                return line.indexOf(line_sub_string) > -1;
            }));
}

function get_last_line_in_file(file_name) {
    return fs.readFileAsync(file_name, 'utf8')
        .then(data => {
            let lines = data.split('\n');
            let idx = lines.length - 1;
            while (!lines[idx] && idx > 0) {
                idx -= 1;
            }
            return lines[idx] || undefined;
        });
}

function create_path(dir, mode) {
    if (mode) {
        return P.fromCallback(callback => mkdirp(dir, mode, callback));
    } else {
        return P.fromCallback(callback => mkdirp(dir, callback));
    }
}

function create_fresh_path(dir) {
    return P.resolve()
        .then(() => folder_delete(dir))
        .then(() => create_path(dir));
}

function file_copy(src, dst) {
    let cmd;
    if (is_windows) {
        cmd = 'copy /Y  "' +
            src.replace(/\//g, '\\') + '" "' +
            dst.replace(/\//g, '\\') + '"';
    } else {
        cmd = 'cp -fp ' + src + ' ' + dst;
    }
    console.log('file_copy:', cmd);
    return promise_utils.exec(cmd);
}

function folder_delete(dir) {
    return P.fromCallback(callback => rimraf(dir, callback));
}

function file_delete(file_name) {
    return fs.unlinkAsync(file_name)
        .catch(ignore_enoent)
        .return();
}

function full_dir_copy(src, dst, filter_regex) {
    return P.fromCallback(callback => {
        ncp.limit = 10;
        let ncp_options = {};
        if (filter_regex) {
            //this regexp will filter out files that matches, except path.
            var ncp_filter_regex = new RegExp(filter_regex);
            var ncp_filter_function = input => {
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
    }).return();
}

function tar_pack(tar_file_name, source, ignore_file_changes) {
    let cmd;
    if (is_mac) {
        cmd = 'tar -zcvf ' + tar_file_name + ' ' + source + '/*';
    } else {
        cmd = 'tar -zcvf ' +
            (ignore_file_changes ? '--warning=no-file-changed ' : '') +
            tar_file_name + ' ' + source + '/*';
    }
    console.log('tar_pack:', cmd);
    return promise_utils.exec(cmd);
}

function write_file_from_stream(file_path, read_stream) {
    return new P((resolve, reject) => read_stream
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
            .then(() => fs.writeFileAsync(tmp_name, data))
            .then(() => fs.renameAsync(tmp_name, file_path))
            .catch(err => fs.unlinkAsync(tmp_name)
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
exports.get_folder_size = get_folder_size;
exports.file_exists = file_exists;
