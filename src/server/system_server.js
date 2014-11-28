// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var LRU = require('noobaa-util/lru');
var db = require('./db');
var rest_api = require('../util/rest_api');
var size_utils = require('../util/size_utils');
var api = require('../api');
var node_monitor = require('./node_monitor');


var system_server = new api.system_api.Server({

    // CRUD
    create_system: create_system,
    read_system: read_system,
    update_system: update_system,
    delete_system: delete_system,

    // LIST
    list_systems: list_systems,

    // ROLES
    add_role: add_role,
    remove_role: remove_role,

}, {
    before: function(req) {
        return req.load_account();
    }
});

module.exports = system_server;



//////////
// CRUD //
//////////


function create_system(req) {
    var system;

    return Q.fcall(function() {
            var info = _.pick(req.rest_params, 'name');
            info.owner = req.account.id;
            return db.System.create(info);
        })
        .then(null, db.check_already_exists(req, 'system'))
        .then(function(system_arg) {
            system = system_arg;
            // TODO if role create fails, we should recover the role from the system owner
            return db.Role.create({
                account: req.account.id,
                system: system.id,
                role: 'admin',
            });
        })
        .then(null, db.check_already_exists(req, 'role'))
        .then(function() {
            return get_system_info(system);
        });
}


function read_system(req) {
    return req.load_system(['admin']).then(function() {
        var minimum_online_heartbeat = node_monitor.get_minimum_online_heartbeat();
        var by_system_id = {
            system: req.system.id
        };
        var by_system_id_undeleted = {
            system: req.system.id,
            deleted: null,
        };

        return Q.all([
            // roles
            db.Role.find(by_system_id).populate('account').exec(),

            // tiers
            db.Tier.find(by_system_id_undeleted).exec(),

            // nodes - count, online count, allocated/used storage
            db.Node.mapReduce({
                query: by_system_id_undeleted,
                scope: {
                    // have to pass variables to map/reduce with a scope
                    minimum_online_heartbeat: minimum_online_heartbeat,
                },
                map: function() {
                    /* global emit */
                    emit('alloc', this.allocated_storage);
                    emit('used', this.used_storage);
                    emit('count', 1);
                    var online = (this.started && this.heartbeat >= minimum_online_heartbeat);
                    if (online) {
                        emit('online', 1);
                    }
                    var tkey = 'tier/' + this.tier + '/';
                    emit(tkey + 'alloc', this.allocated_storage);
                    emit(tkey + 'used', this.used_storage);
                    emit(tkey + 'count', 1);
                    if (online) {
                        emit(tkey + 'online', 1);
                    }
                },
                reduce: size_utils.reduce_sum
            }),

            // objects
            db.ObjectMD.mapReduce({
                query: by_system_id,
                map: function() {
                    /* global emit */
                    emit('size', this.size);
                    emit('count', 1);
                },
                reduce: size_utils.reduce_sum
            }),

            // blocks
            db.DataBlock.mapReduce({
                query: by_system_id,
                map: function() {
                    /* global emit */
                    emit('size', this.size);
                },
                reduce: size_utils.reduce_sum
            }),

            // buckets
            db.Bucket.count(by_system_id).exec(),
        ]);

    }).spread(function(roles, tiers, nodes, objects, blocks, buckets) {
        nodes = _.mapValues(_.indexBy(nodes, '_id'), 'value');
        objects = _.mapValues(_.indexBy(objects, '_id'), 'value');
        blocks = _.mapValues(_.indexBy(blocks, '_id'), 'value');
        return {
            name: req.system.name,
            roles: _.map(roles, function(role) {
                role = _.pick(role, 'role', 'account');
                role.account = _.pick(role.account, 'name', 'email');
                return role;
            }),
            tiers: _.map(tiers, function(tier) {
                var t = _.pick(tier, 'name');
                t.storage = {
                    alloc: nodes['tier/' + t.name + '/alloc'] || 0,
                    used: nodes['tier/' + t.name + '/used'] || 0,
                };
                t.nodes = {
                    count: nodes['tier/' + t.name + '/count'] || 0,
                    online: nodes['tier/' + t.name + '/online'] || 0,
                };
                return t;
            }),
            storage: {
                alloc: nodes.alloc || 0,
                used: objects.size || 0,
                real: blocks.size || 0,
            },
            nodes: {
                count: nodes.count || 0,
                online: nodes.online || 0,
            },
            buckets: buckets || 0,
            objects: objects.count || 0,
        };
    });
}


function update_system(req) {
    return req.load_system(['admin'])
        .then(function() {
            var info = _.pick(req.rest_params, 'name');
            return db.System.findByIdAndUpdate(req.system.id, info).exec();
        })
        .thenResolve();
}


function delete_system(req) {
    return req.load_system(['admin'])
        .then(function() {
            return db.System.findByIdAndUpdate(req.system.id, {
                deleted: new Date()
            }).exec();
        })
        .thenResolve();
}


//////////
// LIST //
//////////


function list_systems(req) {
    return Q.fcall(function() {
            return db.Role.find({
                account: req.account.id
            }).populate('system').exec();
        })
        .then(function(roles) {
            return _.map(roles, function(role) {
                return get_system_info(role.system);
            });
        });
}



//////////
// ROLE //
//////////

function add_role(req) {
    return req.load_system(['admin'])
        .then(function() {
            return db.Account.findOne({
                email: req.rest_params.email,
                deleted: null,
            }).exec();
        })
        .then(db.check_not_deleted(req, 'account'))
        .then(function(account) {
            return db.Role.create({
                account: account.id,
                system: req.system.id,
                role: req.rest_params.role,
            });
        })
        .then(null, db.check_already_exists(req, 'role'))
        .thenResolve();
}

function remove_role(req) {
    return req.load_system(['admin'])
        .then(function() {
            return db.Account.findOne({
                email: req.rest_params.email,
                deleted: null,
            }).exec();
        })
        .then(db.check_not_deleted(req, 'account'))
        .then(function(account) {
            return db.Role.findOneAndRemove({
                account: account.id,
                system: req.system.id,
            }).exec();
        })
        .thenResolve();
}


//////////
// UTIL //
//////////

function get_system_info(system) {
    return _.pick(system, 'name');
}
