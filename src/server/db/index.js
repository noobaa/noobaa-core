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

/**
 *
 * DB FOLDER INDEX
 *
 * fast require of all the db related functionality.
 *
 */
module.exports = {
    ObjectID: mongoose.Schema.Types.ObjectID,

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

    check_not_found: check_not_found,
    check_not_deleted: check_not_deleted,
    check_already_exists: check_already_exists,

    AccountCache: new LRUCache({
        name: 'AccountCache',
        load: function(account_id) {
            // load the account and its roles per system
            return Account.findById(account_id).exec()
                .then(function(account) {
                    if (account.deleted) return;
                    return account;
                });
        }
    }),

    SystemCache: new LRUCache({
        name: 'SystemCache',
        load: function(system_id) {
            // load the system
            return System.findById(system_id).exec()
                .then(function(system) {
                    if (system.deleted) return;
                    return system;
                });
        }
    }),

    BucketCache: new LRUCache({
        name: 'BucketCache',
        key_stringify: function(key) {
            return key.system + ':' + key.name;
        },
        load: function(key) {
            // load the system
            return Bucket.findOne({
                    system: key.system,
                    name: key.name,
                    deleted: null,
                }).exec()
                .then(function(bucket) {
                    return bucket;
                });
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
