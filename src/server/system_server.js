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
var system_api = require('../api/system_api');
var node_monitor = require('./node_monitor');


var system_server = new system_api.Server({
    // CRUD
    create_system: create_system,
    read_system: read_system,
    update_system: update_system,
    delete_system: delete_system,
    // LIST
    list_systems: list_systems,
}, {
    before: before
});

module.exports = system_server;

function before(req) {
    return req.load_account();
}


//////////
// CRUD //
//////////


function create_system(req) {
    var info = _.pick(req.rest_params, 'name');
    var system;
    return Q.fcall(
        function() {
            return db.System.create(info);
        }
    ).then(
        function(system_arg) {
            system = system_arg;
            return db.Role.create({
                account: req.account.id,
                system: system,
                role: 'admin',
            });
        }
    ).then(
        function() {
            return get_system_info(system);
        },
        function(err) {
            // TODO if a system was created but role did not, then the system is in limbo...
            console.error('FAILED create_system', err);
            throw new Error('create system failed');
        }
    );
}


function read_system(req) {
    return req.load_system(['admin']).then(
        function() {
            var minimum_online_heartbeat = node_monitor.get_minimum_online_heartbeat();
            var system_query = {
                system: req.system.id
            };
            return Q.all([
                // nodes - count, online count, allocated/used storage
                db.Node.mapReduce({
                    query: system_query,
                    scope: {
                        // have to pass variables to map/reduce with a scope
                        minimum_online_heartbeat: minimum_online_heartbeat,
                    },
                    map: function() {
                        /* global emit */
                        emit('count', 1);
                        if (this.started && this.heartbeat >= minimum_online_heartbeat) {
                            emit('online', 1);
                        }
                        emit('alloc', this.allocated_storage);
                        emit('used', this.used_storage);
                    },
                    reduce: size_utils.reduce_sum
                }),
                // vendors
                db.Vendor.count(system_query).exec(),
                // buckets
                db.Bucket.count(system_query).exec(),
                // objects
                db.ObjectMD.count(system_query).exec(),
                // parts
                db.ObjectPart.mapReduce({
                    query: system_query,
                    map: function() {
                        /* global emit */
                        emit('size', this.end - this.start);
                    },
                    reduce: size_utils.reduce_sum
                }),
                // TODO chunks and blocks don't have link to system...
                /*
                db.DataChunk.mapReduce({
                map: function() {
                emit('size', this.size);
            },
            reduce: size_utils.reduce_sum
        }),*/
            ]).spread(
                function(nodes, vendors, buckets, objects, parts) {
                    nodes = _.mapValues(_.indexBy(nodes, '_id'), 'value');
                    parts = _.mapValues(_.indexBy(parts, '_id'), 'value');
                    // chunks = chunks && _.mapValues(_.indexBy(chunks, '_id'), 'value');
                    return {
                        id: req.system.id,
                        name: req.system.name,
                        allocated_storage: nodes.alloc || 0,
                        used_storage: parts.size || 0,
                        chunks_storage: 0, //chunks.size || 0,
                        nodes: nodes.count || 0,
                        online_nodes: nodes.online || 0,
                        vendors: vendors || 0,
                        buckets: buckets || 0,
                        objects: objects || 0,
                    };
                }
            );

        }
    );
}


function update_system(req) {
    var info = _.pick(req.rest_params, 'name');
    return req.load_system(['admin']).then(
        function() {
            return db.System.findByIdAndUpdate(req.system.id, info).exec();
        }
    ).thenResolve();
}


function delete_system(req) {
    return req.load_system(['admin']).then(
        function() {
            return db.System.findByIdAndUpdate(req.system.id, {
                deleted: new Date()
            }).exec();
        }
    ).thenResolve();
}


//////////
// LIST //
//////////


function list_systems(req) {
    return Q.fcall(
        function() {
            return db.Role.find({
                account: req.account.id
            }).populate('system').exec();
        }
    ).then(
        function(roles) {
            return _.map(roles, function(role) {
                return _.pick(role.system, 'name');
            });
        },
        function(err) {
            console.error('FAILED list_systems', err);
            throw new Error('list systems failed');
        }
    );
}



//////////
// UTIL //
//////////

function get_system_info(system) {
    return _.pick(system, 'id', 'name');
}
