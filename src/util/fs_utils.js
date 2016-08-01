'use strict';

// const _ = require('lodash');
const fs = require('fs');
const ncp = require('ncp').ncp;
const path = require('path');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const readdirp = require('readdirp');

const P = require('./promise');
const promise_utils = require('./promise_utils');

const is_windows = (process.platform === "win32");
const is_mac = (process.platform === "darwin");

const PRIVATE_DIR_PERMISSIONS = parseInt('0700', 8);
/**
 *
 * file_must_not_exist
 *
 */
function file_must_not_exist(file_path) {
    return fs.statAsync(file_path)
        .then(function() {
            throw new Error('exists');
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


/**
 *
 * disk_usage
 *
 */
function disk_usage(dir_path, semaphore, recurse) {
    let size = 0;
    let count = 0;
    let sub_dirs = [];
    // under semaphore we readdir and stat all entries,
    // but before we recurse we want to free the full list of entries
    // and release the semaphore.
    return semaphore.surround(() => {
            console.log('disk_usage: readdir', dir_path, 'sem', semaphore.value);
            return fs.readdirAsync(dir_path)
                .map(entry => {
                    const entry_path = path.join(dir_path, entry);
                    return fs.statAsync(entry_path)
                        .then(stat => {
                            if (stat.isFile()) {
                                size += stat.size;
                                count += 1;
                            } else if (stat.isDirectory() && recurse) {
                                if (stat.size > 64 * 1024 * 1024) {
                                    console.error('disk_usage:',
                                        'dir is huge and might crash the process',
                                        entry_path);
                                    // what to do AAAHH
                                }
                                sub_dirs.push(entry_path);
                            }
                        });
                }, {
                    // setting a separate concurrency for stat per semaphore
                    // because we can't acquire the semaphore recursively
                    // so the total stat concurrency is 32 * max-semaphore
                    concurrency: 32
                })
                .return();
        })
        .then(() => {
            console.log('disk_usage: recursing', dir_path,
                'num sub dirs', sub_dirs.length, 'sem', semaphore.value);
            return P.map(sub_dirs, sub_dir =>
                disk_usage(sub_dir, semaphore, recurse)
                .then(res => {
                    size += res.size;
                    count += res.count;
                }));
        })
        .then(() => {
            console.log('disk_usage: finished', dir_path,
                'size', size, 'count', count);
            return {
                size: size,
                count: count,
            };
        });
}

//ll -laR equivalent
function list_directory(file_path) {
    return new P(function(resolve, reject) {
        var files = [];
        readdirp({
                root: file_path,
                fileFilter: '*'
            },
            function(entry) {
                var entry_info = entry.fullPath + ' size:' + entry.stat.size + ' mtime:' + entry.stat.mtime;
                files.push(entry_info);
            },
            function(err, res) {
                if (err) {
                    return reject(err);
                }

                resolve(files);
            });
    });
}

function list_directory_to_file(file_path, outfile) {
    return list_directory(file_path)
        .then(function(files) {
            return fs.writeFileAsync(outfile, JSON.stringify(files, null, '\n'));
        });
}

// returns the first line in the file that contains the substring
function find_line_in_file(file_name, line_sub_string) {
    return fs.readFileAsync(file_name, 'utf8')
        .then(data => {
            return data.split('\n')
                .find(line => line.indexOf(line_sub_string) > -1);
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
        cmd = 'cp -f ' + src + ' ' + dst;
    }
    console.log('file_copy:', cmd);
    return promise_utils.exec(cmd);
}

function folder_delete(dir) {
    return P.fromCallback(callback => rimraf(dir, callback));
}

function file_delete(file_name) {
    return fs.unlinkAsync(file_name)
        .catch(err => {
            if (err.code !== 'ENOENT') throw err;
        })
        .return();
}

function full_dir_copy(src, dst, filter_regex) {
    return P.fromCallback(callback => {
        ncp.limit = 10;
        let ncp_options = {};
        if (filter_regex) {
            //this regexp will filter out files that matches, except path.
            var ncp_filter_regex = new RegExp(filter_regex);
            var ncp_filter_function = function(input) {
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
    if (is_windows) {
        cmd = '7za.exe a -ttar -so tmp.tar ' +
            source.replace(/\//g, '\\') + '| 7za.exe a -si ' +
            tar_file_name.replace(/\//g, '\\');
    } else if (is_mac) {
        cmd = 'tar -zcvf ' + tar_file_name + ' ' + source + '/*';
    } else {
        cmd = 'tar -zcvf ' +
            (ignore_file_changes ? '--warning=no-file-changed ' : '') +
            tar_file_name + ' ' + source + '/*';
    }
    console.log('tar_pack:', cmd);
    return promise_utils.exec(cmd);
}


// EXPORTS
exports.file_must_not_exist = file_must_not_exist;
exports.file_must_exist = file_must_exist;
exports.disk_usage = disk_usage;
exports.list_directory = list_directory;
exports.list_directory_to_file = list_directory_to_file;
exports.find_line_in_file = find_line_in_file;
exports.create_path = create_path;
exports.create_fresh_path = create_fresh_path;
exports.full_dir_copy = full_dir_copy;
exports.file_copy = file_copy;
exports.file_delete = file_delete;
exports.folder_delete = folder_delete;
exports.tar_pack = tar_pack;
exports.PRIVATE_DIR_PERMISSIONS = PRIVATE_DIR_PERMISSIONS;
