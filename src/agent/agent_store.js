/* jshint node:true */
'use strict';

var _ = require('lodash');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Q = require('q');
var size_utils = require('../util/size_utils');
var Semaphore = require('noobaa-util/semaphore');

module.exports = AgentStore;


/**
 *
 * AgentStore
 *
 */
function AgentStore(root_path) {
    this.root_path = root_path;
}


/**
 *
 * MemoryStore
 *
 * memory only alternative, for testing
 */
AgentStore.MemoryStore = MemoryStore;


/**
 *
 * GET_STATS
 *
 */
AgentStore.prototype.get_stats = function() {
    var self = this;
    return Q.all([
        self.get_usage(),
        self.get_alloc()
    ]).spread(function(usage, alloc) {
        return {
            alloc: alloc,
            used: usage.size,
        };
    });
};


/**
 *
 * GET_USAGE
 *
 */
AgentStore.prototype.get_usage = function() {
    var self = this;
    if (self._usage) {
        return self._usage;
    } else {
        return self._count_usage();
    }
};


/**
 *
 * GET_ALLOC
 *
 */
AgentStore.prototype.get_alloc = function() {
    var self = this;
    return self._read_variables()
        .then(function(variables) {
            return variables && variables.alloc || 0;
        });
};


/**
 *
 * SET_ALLOC
 *
 */
AgentStore.prototype.set_alloc = function(size) {
    var self = this;
    return self._read_variables()
        .then(function(variables) {
            variables = variables || {};
            variables.alloc = size;
            return self._write_variables(variables);
        });
};


/**
 *
 * READ_BLOCK
 *
 */
AgentStore.prototype.read_block = function(block_id) {
    var self = this;
    var block_path = self._get_block_path(block_id);
    return Q.nfcall(fs.readFile, block_path);
};


/**
 *
 * WRITE_BLOCK
 *
 */
AgentStore.prototype.write_block = function(block_id, data) {
    var self = this;
    var block_path = self._get_block_path(block_id);
    var file_stats;

    return self._stat_block_path(block_path, true)
        .then(function(stats) {
            file_stats = stats;
            console.log('write block', block_path, data.length, typeof(data), file_stats);

            // create/replace the block on fs
            return Q.nfcall(fs.writeFile, block_path, data);
        })
        .then(function() {
            if (self._usage) {
                self._usage.size += data.length;
                self._usage.count += 1;
                if (file_stats) {
                    self._usage.size -= file_stats.size;
                    self._usage.count -= 1;
                }
            }
        });
};


/**
 *
 * DELETE_BLOCK
 *
 */
AgentStore.prototype.delete_block = function(block_id) {
    var self = this;
    var block_path = self._get_block_path(block_id);
    var file_stats;

    return self._stat_block_path(block_path, true)
        .then(function(stats) {
            file_stats = stats;
            console.log('delete block', block_path, file_stats);
            if (file_stats) {
                return Q.nfcall(fs.unlink(block_path));
            }
        })
        .then(function() {
            if (self._usage && file_stats) {
                self._usage.size -= file_stats.size;
                self._usage.count -= 1;
            }
        });
};


/**
 *
 * STAT_BLOCK
 *
 */
AgentStore.prototype.stat_block = function(block_id) {
    var self = this;
    var block_path = self._get_block_path(block_id);
    return self._stat_block_path(block_path);
};



// PRIVATE //////////////////////////////////////////////////////////


/**
 *
 * _get_block_path
 *
 */
AgentStore.prototype._get_block_path = function(block_id) {
    return path.join(this.root_path, block_id);
};


/**
 *
 * _stat_block_path
 *
 */
AgentStore.prototype._stat_block_path = function(block_path, resolve_missing) {
    return Q.nfcall(fs.stat, block_path)
        .then(null, function(err) {
            if (resolve_missing && err.code === 'ENOENT') return;
            throw err;
        });
};

/**
 *
 * _read_variables
 *
 */
AgentStore.prototype._read_variables = function() {
    var self = this;
    var variables_file = path.join(self.root_path, '_var');
    return Q.nfcall(fs.readFile, variables_file)
        .then(function(data) {
            return JSON.parse(data);
        }, function(err) {
            if (err.code === 'ENOENT') return;
            throw err;
        });
};

/**
 *
 * _write_variables
 *
 */
AgentStore.prototype._write_variables = function(variables) {
    var self = this;
    var variables_file = path.join(self.root_path, '_var');
    var data = JSON.stringify(variables);
    return Q.nfcall(fs.writeFile, variables_file, data);
};


/**
 *
 * _count_usage
 *
 */
AgentStore.prototype._count_usage = function() {
    var self = this;
    var sem = new Semaphore(10);
    return disk_usage(self.root_path, sem, true)
        .then(function(usage) {
            self._usage = usage; // object with properties size and count
            return usage;
        });
};




// UTILS //////////////////////////////////////////////////////////



/**
 *
 * DISK_USAGE
 *
 */
function disk_usage(path, semaphore, recurse) {
    return Q.nfcall(fs.readdir, path)
        .then(function(files) {
            return q_all_semaphore(semaphore, files, function(file) {
                return Q.nfcall(fs.stat, file).then(function(stats) {
                    if (stats.isDirectory() && recurse) {
                        return disk_usage(path.join(path, file), semaphore, recurse);
                    }
                    if (stats.isFile()) {
                        return {
                            size: stats.size,
                            count: 1,
                        };
                    }
                });
            });
        }).then(function(res) {
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


/**
 *
 * Q_ALL_SEMAPHORE
 *
 */
function q_all_semaphore(semaphore, arr, func) {
    return Q.all(_.map(arr, function(item) {
        return semaphore.surround(function() {
            return func(item);
        });
    }));
}



/**
 *
 * MemoryStore
 *
 * memory only alternative, for testing
 */
function MemoryStore() {
    this._alloc = 0;
    this._used = 0;
    this._count = 0;
    this._blocks = {};
    this.get_stats = function() {
        return {
            alloc: this._alloc,
            used: this._used,
            count: this._count,
        };
    };
    this.get_alloc = function() {
        return this._alloc;
    };
    this.set_alloc = function(size) {
        this._alloc = size;
    };
    this.get_usage = function() {
        return {
            size: this._used,
            count: this._count,
        };
    };
    this.read_block = function(block_id) {
        return this._blocks[block_id];
    };
    this.write_block = function(block_id, data) {
        var b = this._blocks[block_id];
        if (b) {
            this._used -= b.length;
            this._count -= 1;
        }
        this._blocks[block_id] = data;
        this._used += data.length;
        this._count += 1;
    };
    this.delete_block = function(block_id) {
        var b = this._blocks[block_id];
        if (b) {
            this._used -= b.length;
            this._count -= 1;
        }
        delete this._blocks[block_id];
    };
    this.stat_block = function(block_id) {
        var b = this._blocks[block_id];
        return b && {
            size: b.length
        };
    };
}
