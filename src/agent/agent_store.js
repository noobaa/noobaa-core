/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var fs_utils = require('../util/fs_utils');
var Semaphore = require('../util/semaphore');
var dbg = require('../util/debug_module')(__filename);

module.exports = AgentStore;

// error used to throw from here to upper levels
AgentStore.TAMPERING_ERROR = 'TAMPERING';

/**
 *
 * AgentStore
 *
 */
function AgentStore(root_path) {
    this.root_path = root_path;
    this.blocks_path = path.join(this.root_path, 'blocks');
    this.meta_path = path.join(this.root_path, '.meta');
    mkdirp.sync(this.blocks_path);
    mkdirp.sync(this.meta_path);
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
    return P.join(
        self.get_usage(),
        self.get_alloc()
    ).spread(function(usage, alloc) {
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
AgentStore.prototype.read_block = function(block_md) {
    var self = this;
    var block_path = self._get_block_data_path(block_md.id);
    var meta_path = self._get_block_meta_path(block_md.id);
    dbg.log1('fs read block', block_path);
    return P.join(
            fs.readFileAsync(block_path),
            fs.readFileAsync(meta_path))
        .spread(function(data, meta) {
            var block_md_from_store = JSON.parse(meta);
            if (block_md_from_store.id !== block_md.id ||
                block_md_from_store.digest_type !== block_md.digest_type ||
                block_md_from_store.digest_b64 !== block_md.digest_b64) {
                dbg.error('BLOCK MD MISMATCH ON READ', block_md_from_store, block_md);
                throw AgentStore.TAMPERING_ERROR;
            }
            if (block_md.digest_type) {
                var digest_b64 = crypto.createHash(block_md.digest_type)
                    .update(data)
                    .digest('base64');
                if (digest_b64 !== block_md_from_store.digest_b64) {
                    dbg.error('BLOCK DIGEST MISMATCH ON READ', block_md_from_store, digest_b64);
                    throw AgentStore.TAMPERING_ERROR;
                }
            }
            return {
                block_md: block_md,
                data: data,
            };
        });
};


/**
 *
 * WRITE_BLOCK
 *
 */
AgentStore.prototype.write_block = function(block_md, data) {
    var self = this;
    var block_path = self._get_block_data_path(block_md.id);
    var meta_path = self._get_block_meta_path(block_md.id);
    var file_stats;

    if (!Buffer.isBuffer(data) && typeof(data) !== 'string') {
        throw new Error('data is not a buffer/string');
    }

    var block_md_to_store = _.pick(block_md, 'id', 'digest_type', 'digest_b64');
    if (block_md.digest_type) {
        var digest_b64 = crypto.createHash(block_md.digest_type)
            .update(data)
            .digest('base64');
        if (digest_b64 !== block_md_to_store.digest_b64) {
            throw new Error('BLOCK DIGEST MISMATCH ON WRITE');
        }
    }

    return P.when(self._stat_block_path(block_path, true))
        .then(function(stats) {
            file_stats = stats;
            dbg.log1('fs write block', block_path, data.length, typeof(data), file_stats);

            // create/replace the block on fs
            return P.join(
                fs.writeFileAsync(block_path, data),
                fs.writeFileAsync(meta_path, JSON.stringify(block_md_to_store)));
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
 * DELETE_BLOCKS
 *
 */
AgentStore.prototype.delete_blocks = function(block_ids) {
    var self = this;

    // TODO: limit concurrency with semaphore
    return P.settle(_.map(block_ids, function(block_id) {
            return self._delete_block(block_id);
        }))
        .then(function(results) {
            var tmp_usage = {
                size: 0,
                count: 0,
            };
            _.each(results, function(r) {
                if (r.isFulfilled()) {
                    tmp_usage.size += r.value();
                    tmp_usage.count += 1;
                } else {
                    dbg.warn("delete block failed due to ", r.reason());
                    // TODO what to do with failed deletions? report back? reclaim later?
                }
            });
            if (self._usage) {
                self._usage.size -= tmp_usage.size;
                self._usage.count -= tmp_usage.count;
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
    var block_path = self._get_block_data_path(block_id);
    return self._stat_block_path(block_path);
};



// PRIVATE //////////////////////////////////////////////////////////

/**
 *
 * _delete_block
 *
 */
AgentStore.prototype._delete_block = function(block_id) {
    var self = this;
    var block_path = self._get_block_data_path(block_id);
    var meta_path = self._get_block_meta_path(block_id);
    var file_stats;

    dbg.log("delete block", block_id);
    return self._stat_block_path(block_path, true)
        .then(function(stats) {
            file_stats = stats;
            if (file_stats) {
                return fs.unlinkAsync(block_path);
            }
        })
        .then(function() {
            return fs.unlinkAsync(meta_path);
        })
        .then(function() {
            return file_stats ? file_stats.size : 0;
        });
};


/**
 *
 * _get_block_data_path
 *
 */
AgentStore.prototype._get_block_data_path = function(block_id) {
    return path.join(this.blocks_path, block_id + '.data');
};

/**
 *
 * _get_block_meta_path
 *
 */
AgentStore.prototype._get_block_meta_path = function(block_id) {
    return path.join(this.blocks_path, block_id + '.meta');
};

/**
 *
 * _stat_block_path
 *
 */
AgentStore.prototype._stat_block_path = function(block_path, resolve_missing) {
    return fs.statAsync(block_path)
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
    return fs.readFileAsync(config_file)
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
    return fs.writeFileAsync(config_file, data);
};


/**
 *
 * _count_usage
 *
 */
AgentStore.prototype._count_usage = function() {
    var self = this;
    var sem = new Semaphore(10);
    return fs_utils.disk_usage(self.blocks_path, sem, true)
        .then(function(usage) {
            dbg.log0('counted disk usage', usage);
            self._usage = usage; // object with properties size and count
            return usage;
        });
};



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
    this.read_block = function(block_md) {
        var block_id = block_md.id;
        var b = this._blocks[block_id];
        if (!b) {
            throw new Error('No such block ' + block_id);
        }

        if (block_md.digest_type) {
            var digest_b64 = crypto.createHash(block_md.digest_type)
                .update(b.data)
                .digest('base64');
            if (digest_b64 !== block_md.digest_b64) {
                throw AgentStore.TAMPERING_ERROR;
            }
        }

        return b;
    };
    this.write_block = function(block_md, data) {
        var block_id = block_md.id;
        var b = this._blocks[block_id];
        if (b) {
            this._used -= b.length;
            this._count -= 1;
        }

        if (block_md.digest_type) {
            var digest_b64 = crypto.createHash(block_md.digest_type)
                .update(data)
                .digest('base64');
            if (digest_b64 !== block_md.digest_b64) {
                throw new Error('BLOCK DIGEST MISMATCH ON WRITE');
            }
        }

        this._blocks[block_id] = {
            data: data,
            block_md: block_md
        };

        this._used += data.length;
        this._count += 1;
    };
    this.delete_blocks = function(block_ids) {
        var self = this;
        _.each(block_ids, function(block_id) {
            var b = self._blocks[block_id];
            if (b) {
                self._used -= b.length;
                self._count -= 1;
            }
            delete self._blocks[block_id];
        });
    };
    this.stat_block = function(block_id) {
        var b = this._blocks[block_id];
        return b && {
            size: b.length
        };
    };
    /*
     * Testing API
     */
    this.corrupt_blocks = function(block_ids) {
        var self = this;
        _.each(block_ids, function(block_id) {
            var b = self._blocks[block_id];
            if (b) {
                b.hash_val = '';
                b.hash_info = '';
            }
        });
    };
    this.list_blocks = function() {
        var self = this;
        return _.keys(self._blocks);
    };
}
