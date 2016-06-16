'use strict';

// var _ = require('lodash');
var P = require('./promise');
var promise_utils = require('./promise_utils');
var fs = require('fs');
var path = require('path');
var readdirp = require('readdirp');

module.exports = {
    file_must_not_exist: file_must_not_exist,
    file_must_exist: file_must_exist,
    disk_usage: disk_usage,
    list_directory: list_directory,
    list_directory_to_file: list_directory_to_file,
    find_line_in_file: find_line_in_file,
    create_fresh_path: create_fresh_path,
};


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

function create_fresh_path(path) {
    return P.resolve(promise_utils.folder_delete(path))
        .then(() => fs.mkdir(path));
}
