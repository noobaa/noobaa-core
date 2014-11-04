// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var restful_api = require('../util/restful_api');
var fssize_utils = require('../util/fssize_utils');
var edge_node_api = require('../api/edge_node_api');
var account_server = require('./account_server');
// db models
var Account = require('./models/account');
var EdgeNode = require('./models/edge_node');
var DataBlock = require('./models/data_block');


module.exports = new edge_node_api.Server({
    create_node: create_node,
    delete_node: delete_node,
    list_nodes: list_nodes,
    read_node: read_node,
    heartbeat: heartbeat,
}, [
    // middleware to verify the account session before any of this server calls
    account_server.account_session
]);


function create_node(req) {
    var info = _.pick(req.restful_params, 'name', 'location', 'allocated_storage');
    info.account = req.account.id; // see account_server.account_session
    info.heartbeat = new Date();
    info.used_storage = {};
    return Q.fcall(
        function() {
            return EdgeNode.create(info);
        }
    ).then(reply_undefined);
}


function delete_node(req) {
    var info = _.pick(req.restful_params, 'name');
    info.account = req.account.id; // see account_server.account_session
    var node;
    return Q.fcall(
        function() {
            return EdgeNode.findOne(info).exec();
        }
    ).then(
        function(node_arg) {
            node = node_arg;
            if (!node) {
                throw new Error('node not found ' + info.name);
            }
            return DataBlock.findOne({
                node: node.id
            }).exec();
        }
    ).then(
        function(block) {
            if (block) {
                // TODO initiate rebuild
                console.log('DELETE NODE WITH BLOCK', block);
            }
            return node.remove();
        }
    ).then(reply_undefined);
}


function list_nodes(req) {
    var info = {};
    info.account = req.account.id; // see account_server.account_session
    return Q.fcall(
        function() {
            return EdgeNode.find(info).exec();
        }
    ).then(
        function(nodes) {
            return {
                nodes: _.map(nodes, get_node_info)
            };
        }
    );
}


function read_node(req) {
    var info = _.pick(req.restful_params, 'name');
    info.account = req.account.id; // see account_server.account_session
    return Q.fcall(
        function() {
            return EdgeNode.findOne(info).exec();
        }
    ).then(
        function(node) {
            if (!node) {
                throw new Error('node not found ' + info.name);
            }
            return get_node_info(node);
        }
    );
}


function heartbeat(req) {
    var info = _.pick(req.restful_params, 'name');
    info.account = req.account.id; // see account_server.account_session

    var updates = _.pick(req.restful_params,
        'location',
        'ip',
        'port',
        'allocated_storage');
    updates.ip = (updates.ip && updates.ip !== '0.0.0.0' && updates.ip) ||
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress;
    updates.heartbeat = new Date();

    var used_storage = req.restful_params.used_storage;

    return Q.fcall(
        function() {
            return EdgeNode.findOne(info).exec();
        }
    ).then(
        function(node) {
            if (!node) {
                throw new Error('node not found ' + info.name);
            }

            // we log the updates,
            // probably need to detect nodes that change too rapidly

            if (updates.location !== node.location) {
                console.log('NODE change location from',
                    node.location, 'to', updates.location);
            }
            if (updates.ip !== node.ip || updates.port !== node.port) {
                console.log('NODE change ip:port from',
                    node.ip + ':' + node.port, 'to',
                    updates.ip + ':' + updates.port);
            }
            if (!fssize_utils.is_equal(updates.allocated_storage, node.allocated_storage)) {
                console.log('NODE change allocated storage from',
                    node.allocated_storage, 'to', updates.allocated_storage);
            }

            // used storage is verified but not updated
            if (!fssize_utils.is_equal(used_storage, node.used_storage)) {
                console.log('NODE used storage mismatch',
                    node.used_storage, 'got', used_storage);
                // TODO trigger a usage check
            }

            return EdgeNode.findByIdAndUpdate(node.id, updates).exec();
        }
    ).then(
        function(node) {
            return get_node_info(node);
        }
    );
}


function get_node_info(node) {
    var info = _.pick(node,
        'name',
        'location'
    );
    info.ip = node.ip || '0.0.0.0';
    info.port = node.port || 0;
    info.heartbeat = node.heartbeat.toString();
    info.allocated_storage = fssize_utils.clone(node.allocated_storage);
    info.used_storage = fssize_utils.clone(node.used_storage);
    return info;
}

function reply_undefined() {}
