'use strict';

var _ = require('lodash');
var Q = require('q');

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
            return Q.all([
                Account.findById(account_id).exec(),
                Role.find({
                    account: account_id
                }).exec(),
            ]).spread(function(account, roles) {
                account = _.pick(account, 'id', 'name', 'email');
                // systems_role is a map of: system_id -> role
                account.systems_role = _.mapValues(_.indexBy(roles, 'system'), 'role');
                return account;
            });
        }
    }),

    SystemCache: new DBCache({
        name: 'SystemCache',
        load: function(system_id) {
            // load the system
            return Q.all([
                System.findById(system_id).exec(),
                Vendor.find({
                    system: system_id
                }).exec(),
                Tier.find({
                    system: system_id
                }).exec(),
            ]).spread(function(system, vendors, tiers) {
                system = _.pick(system, 'id', 'name');
                system.vendors = _.map(vendors, function(vendor) {
                    return _.pick(vendor, 'id', 'name', 'category', 'kind', 'vendor_info');
                });
                system.tiers = _.map(tiers, function(tier) {
                    return _.pick(tier, 'id', 'name');
                });
                return system;
            });
        }
    }),

};
