'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var path = require('path');

module.exports = {
    file_must_not_exist: file_must_not_exist,
    file_must_exist: file_must_exist,
    disk_usage: disk_usage
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
