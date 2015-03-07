'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');

var LRUCache = require('../../util/lru_cache');
var Account = require('./account');
var Role = require('./role');
var System = require('./system');
var Tier = require('./tier');
var Node = require('./node');
var Bucket = require('./bucket');
var ObjectMD = require('./object_md');
var ObjectPart = require('./object_part');
var DataChunk = require('./data_chunk');
var DataBlock = require('./data_block');
var ActivityLog = require('./activity_log');

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

    check_not_found: check_not_found,
    check_not_deleted: check_not_deleted,
    check_already_exists: check_already_exists,

    AccountCache: new LRUCache({
        name: 'AccountCache',
        load: function(account_id) {
            console.log('AccountCache: load', account_id);
            return Q.when(Account.findById(account_id).exec())
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
            return Q.when(System.findById(system_id).exec())
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
            return Q.when(Bucket.findOne({
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
            return Q.when(Tier.findOne({
                    system: params.system,
                    name: params.name,
                    deleted: null,
                }).exec());
        }
    }),
};


function check_not_found(req, entity) {
    return function(doc) {
        if (!doc) throw req.rest_error(entity + ' not found');
        return doc;
    };
}

function check_not_deleted(req, entity) {
    return function(doc) {
        if (!doc || doc.deleted) throw req.rest_error(entity + ' not found');
        return doc;
    };
}

function check_already_exists(req, entity) {
    return function(err) {
        if (err.code === 11000) throw req.rest_error(entity + ' already exists');
        throw err;
    };
}
