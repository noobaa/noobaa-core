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
var AWS = require('aws-sdk');
var https = require('https');

module.exports = AgentStore;

// error used to throw from here to upper levels
AgentStore.TAMPERING_ERROR = 'TAMPERING';

/**
 *
 * AgentStore
 *
 */
function AgentStore(root_path, storage_limit) {
    this.root_path = root_path;
    this.blocks_path = path.join(this.root_path, 'blocks');
    this.meta_path = path.join(this.root_path, '.meta');
    mkdirp.sync(this.blocks_path);
    mkdirp.sync(this.meta_path);
    if (storage_limit) {
        this._storage_limit = storage_limit;
    }
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
            self._read_internal(block_path),
            self._read_internal(meta_path))
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
    let block_md_data = JSON.stringify(block_md_to_store);

    if (self._storage_limit) {
        let free_space = self._storage_limit - self._usage.size;
        let required_space = data.length + block_md_data.length;
        if (free_space < required_space) {
            throw new Error('used space exceeded the storage limit of ' + self._storage_limit + ' bytes');
        }
    }

    return P.when(self._stat_block_path(block_path, true))
        .then(function(stats) {
            file_stats = stats;
            dbg.log1('fs write block', block_path, data.length, typeof(data), file_stats);
            // create/replace the block on fs
            return P.join(
                self._write_internal(block_path, data),
                self._write_internal(meta_path, block_md_data));
        })
        .then(function() {
            if (self._usage) {
                self._usage.size += data.length + block_md_data.length;
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



AgentStore.prototype._write_internal = function(path, data) {
    return fs.writeFileAsync(path, data);
};

AgentStore.prototype._read_internal = function(path) {
    return fs.readFileAsync(path);
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
 * CloudStore - underlying store which uses s3 cloud storage
 *
 */
class CloudStore extends AgentStore {

    constructor(root_path, cloud_info) {
        super(root_path);
        this.cloud_info = cloud_info;
        this.block_path = cloud_info.block_path || "noobaa_blocks/";
    }

    _write_internal(path, data) {
        var self = this;

        if (!self.s3cloud) {
            self._create_s3cloud();
        }

        var params = {
            Bucket: self.cloud_info.target_bucket,
            Key: path,
            Body: data
        };

        return P.ninvoke(self.s3cloud, 'putObject', params)
            .fail(function(error) {
                dbg.error('CloudStore write failed:', error.statusCode, self.cloud_info);
                if (error.statusCode === 400 ||
                    error.statusCode === 301) {
                    dbg.log0('Resetting (put object) signature type and region to eu-central-1 and v4', params);
                    // change default region from US to EU due to restricted signature of v4 and end point
                    //TODO: maybe we should add support here for cloud sync from noobaa to noobaa after supporting v4.
                    self.s3clouds = new AWS.S3({
                        accessKeyId: self.cloud_info.access_keys.access_key,
                        secretAccessKey: self.cloud_info.access_keys.secret_key,
                        signatureVersion: 'v4',
                        region: 'eu-central-1'
                    });
                    return P.ninvoke(self.s3clouds, 'putObject', params)
                        .fail(function(err) {
                            dbg.error('CloudStore write failed', error.statusCode, self.cloud_info);
                            throw new Error('failed to upload chunk to cloud pool');
                        });
                } else {
                    dbg.error('CloudStore write failed:', error.statusCode, self.cloud_info);
                    throw new Error('failed to write to CloudStore: ' + self.cloud_info);
                }
            });


    }

    _read_internal(path) {
        var self = this;
        if (!self.s3cloud) {
            self._create_s3cloud();
        }

        var params = {
            Bucket: self.cloud_info.target_bucket,
            Key: path,
        };
        return P.ninvoke(self.s3cloud, 'getObject', params)
            .then(data => data.Body)
            .fail(function(error) {
                dbg.error('CloudStore read failed:', error.statusCode, self.cloud_info);
                if (error.statusCode === 400 ||
                    error.statusCode === 301) {
                    dbg.log0('Resetting (put object) signature type and region to eu-central-1 and v4', params);
                    // change default region from US to EU due to restricted signature of v4 and end point
                    //TODO: maybe we should add support here for cloud sync from noobaa to noobaa after supporting v4.
                    self.s3clouds = new AWS.S3({
                        accessKeyId: self.cloud_info.access_keys.access_key,
                        secretAccessKey: self.cloud_info.access_keys.secret_key,
                        signatureVersion: 'v4',
                        region: 'eu-central-1'
                    });
                    return P.ninvoke(self.s3clouds, 'getObject', params)
                        .then(data => data.Body)
                        .fail(function(err) {
                            dbg.error('CloudStore read failed', error.statusCode, self.cloud_info);
                            throw new Error('failed to read chunk from cloud pool');
                        });
                } else {
                    dbg.error('CloudStore read failed:', error.statusCode, self.cloud_info);
                    throw new Error('failed to read from CloudStore: ' + self.cloud_info);
                }
            });
    }

    _delete_block(block_id) {
        var self = this;
        if (!self.s3cloud) {
            self._create_s3cloud();
        }

        var block_path = self._get_block_data_path(block_id);
        var meta_path = self._get_block_meta_path(block_id);

        var params = {
            Bucket: self.cloud_info.target_bucket,
            Delete: {
                Objects: [{
                    Key: block_path
                }, {
                    Key: meta_path
                }]
            }
        };

        return P.ninvoke(self.s3cloud, 'deleteObjects', params)
            .fail(function(error) {
                dbg.error('CloudStore read failed:', error, self.cloud_info);
                if (error.statusCode === 400 ||
                    error.statusCode === 301) {
                    dbg.log0('Resetting (put object) signature type and region to eu-central-1 and v4', params);
                    // change default region from US to EU due to restricted signature of v4 and end point
                    //TODO: maybe we should add support here for cloud sync from noobaa to noobaa after supporting v4.
                    self.s3clouds = new AWS.S3({
                        accessKeyId: self.cloud_info.access_keys.access_key,
                        secretAccessKey: self.cloud_info.access_keys.secret_key,
                        signatureVersion: 'v4',
                        region: 'eu-central-1'
                    });
                    return P.ninvoke(self.s3clouds, 'getObject', params)
                        .fail(function(err) {
                            dbg.error('CloudStore delete failed', error, self.cloud_info);
                            throw new Error('failed to delete chunk from cloud pool');
                        });
                } else {
                    dbg.error('CloudStore read failed:', error, self.cloud_info);
                    throw new Error('failed to delete from CloudStore: ' + self.cloud_info);
                }
            })
            .then(() => 0);
    }


    _create_s3cloud() {
        let endpoint = this.cloud_info.endpoint;

        // upload copy to s3 cloud storage.
        if (endpoint === 'https://s3.amazonaws.com') {
            this.s3cloud = new AWS.S3({
                endpoint: endpoint,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                region: 'us-east-1'
            });
        } else {
            this.s3cloud = new AWS.S3({
                endpoint: endpoint,
                s3ForcePathStyle: true,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                httpOptions: {
                  agent: new https.Agent({
                    rejectUnauthorized: false,
                  })
                }
            });
        }
    }

    _stat_block_path(block_path, resolve_missing) {
        return;
    }

    _count_usage() {
        //TODO: get usage count
        return 0;
    }

}

AgentStore.CloudStore = CloudStore;


/**
 *
 * MemoryStore
 *
 * memory only alternative, for testing
 */
function MemoryStore() {
    this._alloc = 0;
    this._used = 0;
    this._free = 20 * 1024 * 1024 * 1024;
    this._count = 0;
    this._blocks = {};
    this.get_stats = function() {
        return {
            alloc: this._alloc,
            used: this._used,
            free: (this._free - this._used),
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
