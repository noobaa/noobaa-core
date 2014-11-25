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
            return Q.fcall(
                function() {
                    return Account.findById(account_id).exec();
                }
            ).then(
                function(account) {
                    return _.pick(account, 'id', 'name', 'email');
                }
            );
        }
    }),

    SystemCache: new DBCache({
        name: 'SystemCache',
        load: function(system_id) {
            // load the system
            return Q.fcall(
                function() {
                    return System.findById(system_id).exec();
                }
            ).then(
                function(system) {
                    return _.pick(system, 'id', 'name');
                }
            );
        }
    }),

};
