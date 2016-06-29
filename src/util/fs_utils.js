'use strict';

// const _ = require('lodash');
const fs = require('fs');
const ncp = require('ncp').ncp;
const path = require('path');
const rimraf = require('rimraf');
const readdirp = require('readdirp');

const P = require('./promise');
const promise_utils = require('./promise_utils');

const is_windows = (process.platform === "win32");
const is_mac = (process.platform === "darwin");


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
function disk_usage(file_path, semaphore, recurse) {
    // surround fs io with semaphore
    return semaphore.surround(function() {
            return fs.statAsync(file_path);
        })
        .then(function(stats) {

            if (stats.isFile()) {
                return {
                    size: stats.size,
                    count: 1,
                };
            }

            if (stats.isDirectory() && recurse) {
                // surround fs io with semaphore
                return semaphore.surround(function() {
                        return fs.readdirAsync(file_path);
                    })
                    .then(function(entries) {
                        return P.map(entries, function(entry) {
                            var entry_path = path.join(file_path, entry);
                            return disk_usage(entry_path, semaphore, recurse);
                        });
                    })
                    .then(function(res) {
                        var size = 0;
                        var count = 0;
                        for (var i = 0; i < res.length; i++) {
                            if (!res[i]) continue;
                            size += res[i].size;
                            count += res[i].count;
                        }
                        return {
                            size: size,
                            count: count,
                        };
                    });
            }
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

function create_fresh_path(dir) {
    return P.resolve()
        .then(() => folder_delete(dir))
        .then(() => fs.mkdirAsync(dir));
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
exports.create_fresh_path = create_fresh_path;
exports.full_dir_copy = full_dir_copy;
exports.file_copy = file_copy;
exports.file_delete = file_delete;
exports.folder_delete = folder_delete;
exports.tar_pack = tar_pack;
