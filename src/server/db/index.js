'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');

var DBCache = require('../../util/db_cache');
var Account = require('./account');
var Role = require('./role');
var System = require('./system');
var Vendor = require('./vendor');
var Tier = require('./tier');
var Node = require('./node');
var Bucket = require('./bucket');
var ObjectMD = require('./object_md');
var ObjectPart = require('./object_part');
var DataChunk = require('./data_chunk');
var DataBlock = require('./data_block');

module.exports = {
    ObjectID: mongoose.Schema.Types.ObjectID,

    Account: Account,
    Role: Role,
    System: System,
    Vendor: Vendor,
    Tier: Tier,
    Node: Node,
    Bucket: Bucket,
    ObjectMD: ObjectMD,
    ObjectPart: ObjectPart,
    DataChunk: DataChunk,
    DataBlock: DataBlock,

    AccountCache: new DBCache({
        name: 'AccountCache',
        load: function(account_id) {
            // load the account and its roles per system
            return Account.findById(account_id).exec()
                .then(function(account) {
                    if (account.deleted) return;
                    return _.pick(account, 'id', 'name', 'email');
                });
        }
    }),

    SystemCache: new DBCache({
        name: 'SystemCache',
        load: function(system_id) {
            // load the system
            return System.findById(system_id).exec()
                .then(function(system) {
                    if (system.deleted) return;
                    return _.pick(system, 'id', 'name');
                });
        }
    }),

    check_not_found: check_not_found,
    check_not_deleted: check_not_deleted,
    check_already_exists: check_already_exists,
};


function check_not_found(req, entity, allow_deleted) {
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
