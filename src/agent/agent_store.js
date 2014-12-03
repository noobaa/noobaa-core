/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var mkdirp = require('mkdirp');
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
    mkdirp.sync(root_path);
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
    return self._read_config()
        .then(function(config) {
            return config && config.alloc || 0;
        });
};


/**
 *
 * SET_ALLOC
 *
 */
AgentStore.prototype.set_alloc = function(size) {
    var self = this;
    return self._read_config()
        .then(function(config) {
            config = config || {};
            config.alloc = size;
            return self._write_config(config);
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

    if (!Buffer.isBuffer(data)) {
        throw new Error('data is not a buffer');
    }

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
 * _read_config
 *
 */
AgentStore.prototype._read_config = function() {
    var self = this;
    var config_file = path.join(self.root_path, 'config');
    return Q.nfcall(fs.readFile, config_file)
        .then(function(data) {
            return JSON.parse(data);
        }, function(err) {
            if (err.code === 'ENOENT') return;
            throw err;
        });
};

/**
 *
 * _write_config
 *
 */
AgentStore.prototype._write_config = function(config) {
    var self = this;
    var config_file = path.join(self.root_path, 'config');
    var data = JSON.stringify(config);
    return Q.nfcall(fs.writeFile, config_file, data);
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
            console.log('counted disk usage', usage);
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
