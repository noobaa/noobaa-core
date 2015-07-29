'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var path = require('path');
var readdirp = require('readdirp');

module.exports = {
    file_must_not_exist: file_must_not_exist,
    file_must_exist: file_must_exist,
    disk_usage: disk_usage,
    list_directory: list_directory,
    list_directory_to_file: list_directory_to_file,
};


/**
 *
 * file_must_not_exist
 *
 */
function file_must_not_exist(path) {
    return Q.nfcall(fs.stat, path)
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
function file_must_exist(path) {
    return Q.nfcall(fs.stat, path).thenResolve();
}


/**
 *
 * disk_usage
 *
 */
function disk_usage(file_path, semaphore, recurse) {
    // surround fs io with semaphore
    return semaphore.surround(function() {
            return Q.nfcall(fs.stat, file_path);
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
                        return Q.nfcall(fs.readdir, file_path);
                    })
                    .then(function(entries) {
                        return Q.all(_.map(entries, function(entry) {
                            var entry_path = path.join(file_path, entry);
                            return disk_usage(entry_path, semaphore, recurse);
                        }));
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
function list_directory(path) {
    return Q.Promise(function(resolve, reject) {
        var files = [];
        readdirp({
                root: path,
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

function list_directory_to_file(path, outfile) {
    return list_directory(path)
        .then(function(files) {
            return Q.nfcall(fs.writeFile, outfile, JSON.stringify(files, null, '\n'));
        });
}
