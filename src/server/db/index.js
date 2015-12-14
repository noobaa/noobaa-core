'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var mongoose = require('mongoose');
var mongoose_logger = require('../../util/mongoose_logger');
var dbg = require('../../util/debug_module')(__filename);


var LRUCache = require('../../util/lru_cache');
var Account = require('./account');
var Role = require('./role');
var System = require('./system');
var Tier = require('./tier');
var Node = require('./node');
var Bucket = require('./bucket');
var Cluster = require('./cluster');
var ObjectMD = require('./object_md');
var ObjectPart = require('./object_part');
var DataChunk = require('./data_chunk');
var DataBlock = require('./data_block');
var ActivityLog = require('./activity_log');
var Pool = require('./pool');
var TieringPolicy = require('./tiering_policy');
var dbutils = require('./dbutils');
// var dbg = require('../util/debug_module')(__filename);
var debug_mode = (process.env.DEBUG_MODE === 'true');
var mongoose_connected = false;
var mongoose_timeout = null;

// connect to the database
if (debug_mode) {
    mongoose.set('debug', mongoose_logger(dbg.log0.bind(dbg)));
}

mongoose.connection.on('connected', function() {
    // call ensureIndexes explicitly for each model
    console.log('mongoose connection connected');
    mongoose_connected = true;
    return P.all(_.map(mongoose.modelNames(), function(model_name) {
        return P.npost(mongoose.model(model_name), 'ensureIndexes');
    }));
});

mongoose.connection.on('error', function(err) {
    mongoose_connected = false;
    console.error('mongoose connection error:', err);
    if (!mongoose_timeout) {
        mongoose_timeout = setTimeout(mongoose_conenct, 5000);
    }

});

mongoose.connection.on('disconnected', function () {
    mongoose_connected = false;
    console.error('mongoose connection disconnected');
    if (!mongoose_timeout) {
        mongoose_timeout = setTimeout(mongoose_conenct, 5000);
    }
});


/**
 *
 * DB FOLDER INDEX
 *
 * fast require of all the db related functionality.
 *
 */
module.exports = {

    // this ObjectId is a function that generates mongo ObjectId.
    // notice that this is not the same as mongoose.Schema.Types.ObjectId
    // which is used in schema definitions. this mongoose duality will probably
    // be confusing and buggy...
    new_object_id: mongoose.Types.ObjectId,

    Account: Account,
    Role: Role,
    System: System,
    Tier: Tier,
    Node: Node,
    Bucket: Bucket,
    ObjectMD: ObjectMD,
    ObjectPart: ObjectPart,
    DataChunk: DataChunk,
    DataBlock: DataBlock,
    ActivityLog: ActivityLog,
    Cluster: Cluster,
    Pool: Pool,
    TieringPolicy: TieringPolicy,

    check_not_found: check_not_found,
    check_not_deleted: check_not_deleted,
    mongoose_conenct: mongoose_conenct,
    check_already_exists: check_already_exists,
    is_err_exists: is_err_exists,
    obj_ids_difference: obj_ids_difference,
    populate: dbutils.populate,
    uniq_ids: dbutils.uniq_ids,

    AccountCache: new LRUCache({
        name: 'AccountCache',
        load: function(account_id) {
            console.log('AccountCache: load', account_id);
            return P.when(Account.findById(account_id).exec())
                .then(function(account) {
                    if (!account || account.deleted) return;
                    return account;
                });
        }
    }),

    SystemCache: new LRUCache({
        name: 'SystemCache',
        load: function(system_id) {
            console.log('SystemCache: load', system_id);
            return P.when(System.findById(system_id).exec())
                .then(function(system) {
                    if (!system || system.deleted) return;
                    return system;
                });
        }
    }),

    BucketCache: new LRUCache({
        name: 'BucketCache',
        make_key: function(params) {
            return params.system + ':' + params.name;
        },
        load: function(params) {
            console.log('BucketCache: load', params.name);
            return P.when(Bucket.findOne({
                system: params.system,
                name: params.name,
                deleted: null,
            }).exec());
        }
    }),

    TierCache: new LRUCache({
        name: 'TierCache',
        make_key: function(params) {
            return params.system + ':' + params.name;
        },
        load: function(params) {
            console.log('TierCache: load', params.name);
            return P.when(Tier.findOne({
                system: params.system,
                name: params.name,
                deleted: null,
            }).exec());
        }
    }),

    PoolCache: new LRUCache({
        name: 'PoolCache',
        make_key: function(params) {
            return params.system + ':' + params.name;
        },
        load: function(params) {
            console.log('PoolCache: load', params.name);
            return P.when(Pool.findOne({
                system: params.system,
                name: params.name,
                deleted: null,
            }).exec());
        }
    }),

    TieringPolicyCache: new LRUCache({
        name: 'TieringPolicyCache',
        make_key: function(params) {
            return params.system + ':' + params.name;
        },
        load: function(params) {
            console.log('TieringPolicyCache: load', params.name);
            return P.when(TieringPolicy.findOne({
                system: params.system,
                name: params.name,
                deleted: null,
            }).exec());
        }
    }),

    // short living cache for objects
    // the purpose is to reduce hitting the DB many many times per second during upload/download.
    ObjectMDCache: new LRUCache({
        name: 'ObjectMDCache',
        max_length: 1000,
        expiry_ms: 1000, // 1 second of blissfull ignorance
        make_key: function(params) {
            return params.system + ':' + params.bucket + ':' + params.key;
        },
        load: function(params) {
            console.log('ObjectMDCache: load', params.name);
            return P.when(ObjectMD.findOne({
                system: params.system,
                bucket: params.bucket,
                key: params.key,
                deleted: null,
            }).exec());
        }
    }),
};



function mongoose_conenct() {
    console.error('mongoose attempt to connect');

    clearTimeout(mongoose_timeout);
    mongoose_timeout = null;
    if (!mongoose_connected) {
        mongoose.connect(
            process.env.MONGOHQ_URL ||
            process.env.MONGOLAB_URI ||
            'mongodb://localhost/nbcore');
    }
}

function check_not_found(req, entity) {
    return function(doc) {
        if (!doc) {
            if (typeof(req) !== 'undefined') {
                throw req.rpc_error('NOT_FOUND', entity + ' not found');
            } else {
                throw new Error('NOT_FOUND', entity + ' not found');
            }
        }
        return doc;
    };
}

function check_not_deleted(req, entity) {
    return function(doc) {
        if (!doc || doc.deleted) {
            if (typeof(req) !== 'undefined') {
                throw req.rpc_error('NOT_FOUND', entity + ' not found');
            } else {
                throw new Error('NOT_FOUND', entity + ' not found');
            }
        }
        return doc;
    };
}

function check_already_exists(req, entity) {
    return function(err) {
        if (is_err_exists(err)) {
            if (typeof(req) !== 'undefined') {
                throw req.rpc_error('CONFLICT', entity + ' already exists');
            } else {
                throw new Error('CONFLICT', entity + ' already exists');
            }
        }
        throw err;
    };
}

function is_err_exists(err) {
    return err && err.code === 11000;
}

/*
 *@param base - the array to subtract from
 *@param values - array of values to subtract from base
 *@out - return an array of string containing values in base which did no appear in values
 */
function obj_ids_difference(base, values) {
    var map_base = {};
    for (var i = 0; i < base.length; ++i) {

        map_base[base[i]] = base[i];
    }
    for (i = 0; i < values.length; ++i) {

        delete map_base[values[i]];
    }

    return _.values(map_base);
}
