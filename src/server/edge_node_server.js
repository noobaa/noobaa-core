// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var restful_api = require('../util/restful_api');
var edge_node_api = require('../api/edge_node_api');
var agent_host_api = require('../api/agent_host_api');
var account_server = require('./account_server');
var Semaphore = require('noobaa-util/semaphore');
var Agent = require('../agent/agent');
// db models
var Account = require('./models/account');
var EdgeNode = require('./models/edge_node');
var DataBlock = require('./models/data_block');
var NodeVendor = require('./models/node_vendor');


module.exports = new edge_node_api.Server({
    create_node: create_node,
    delete_node: delete_node,
    list_nodes: list_nodes,
    read_node: read_node,
    heartbeat: heartbeat,
    start_agents: start_agents,
    stop_agents: stop_agents,
    get_node_vendors: get_node_vendors,
    connect_node_vendor: connect_node_vendor,
}, [
    // middleware to verify the account session before any of this server calls
    account_server.account_session
]);


function create_node(req) {
    var info = _.pick(req.restful_params,
        'name',
        'geolocation',
        'allocated_storage',
        'vendor',
        'vendor_node_id'
    );
    info.account = req.account.id; // see account_server.account_session
    info.heartbeat = new Date();
    info.used_storage = 0;
    return Q.fcall(
        function() {
            return EdgeNode.create(info);
        }
    ).thenResolve();
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
    ).thenResolve();
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
        'geolocation',
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

            if (updates.geolocation !== node.geolocation) {
                console.log('NODE change geolocation from',
                    node.geolocation, 'to', updates.geolocation);
            }
            if (updates.ip !== node.ip || updates.port !== node.port) {
                console.log('NODE change ip:port from',
                    node.ip + ':' + node.port, 'to',
                    updates.ip + ':' + updates.port);
            }
            if (updates.allocated_storage !== node.allocated_storage) {
                console.log('NODE change allocated storage from',
                    node.allocated_storage, 'to', updates.allocated_storage);
            }

            // used storage is verified but not updated
            if (used_storage !== node.used_storage) {
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



function toggle_agents(account, node_names, start_or_stop) {
    return Q.fcall(
        function() {
            return EdgeNode.find({
                account: account.id,
                name: {
                    $in: node_names
                }
            }).populate('vendor').exec();
        }
    ).then(
        function(nodes) {
            var sem = new Semaphore(3);
            return Q.all(_.map(nodes,
                function(node) {
                    if (node.vendor.kind !== 'agent_host') {
                        throw new Error('NODE VENDOR KIND UNIMPLEMENTED - ' + node.vendor.kind);
                    }
                    return sem.surround(function() {
                        var agent_host_client = new agent_host_api.Client(node.vendor.info);
                        var host_func = (start_or_stop === 'start') ?
                            agent_host_client.start_agent :
                            agent_host_client.stop_agent;
                        return host_func({
                            name: node.name,
                            geolocation: node.geolocation,
                        });
                    });
                }
            ));
        }
    ).thenResolve();
}

function start_agents(req) {
    var node_names = req.restful_params.nodes;
    return toggle_agents(req.account, node_names, true);
}

function stop_agents(req) {
    var node_names = req.restful_params.nodes;
    return toggle_agents(req.account, node_names, false);
}


function get_node_vendors(req) {
    return Q.fcall(
        function() {
            return NodeVendor.find({
                account: req.account.id
            }).exec();
        }
    ).then(
        function(vendors) {
            return {
                vendors: _.map(vendors, function(v) {
                    return _.pick(v, 'id', 'kind');
                })
            };
        }
    );
}


function connect_node_vendor(req) {
    var vendor_info = _.pick(req.restful_params, 'id', 'kind', 'info');
    vendor_info.account = req.account.id; // see account_server.account_session
    var vendor;
    return Q.fcall(
        function() {
            if (vendor_info.id) {
                return NodeVendor.findById(vendor_info.id).exec();
            } else {
                return NodeVendor.create(vendor_info);
            }
        }
    ).then(
        function(vendor_arg) {
            vendor = vendor_arg;
            if (!vendor) {
                console.error('NODE VENDOR NOT FOUND', vendor_info);
                throw new Error('node vendor not found');
            }
            if (String(req.account.id) !== String(vendor.account)) {
                console.error('NODE VENDOR ACCOUNT MISMATCH', vendor.account, req.account);
                throw new Error('node vendor account mismatch');
            }
            // find all nodes hosted by this vendor
            return EdgeNode.find({
                vendor: vendor.id
            }).select('name').exec();
        }
    ).then(
        function(nodes) {
            var node_names = _.pluck(nodes, 'name');
            return toggle_agents(req.account, node_names , 'start');
        }
    ).then(
        function() {
            return _.pick(vendor, 'id', 'kind');
        }
    );
}


function get_node_info(node) {
    var info = _.pick(node,
        'name',
        'geolocation',
        'allocated_storage',
        'used_storage'
    );
    info.ip = node.ip || '0.0.0.0';
    info.port = node.port || 0;
    info.heartbeat = node.heartbeat.toString();
    var vendor_id = node.populated('vendor');
    if (!vendor_id) {
        vendor_id = node.vendor;
    }
    if (vendor_id) {
        info.vendor = vendor_id.toString();
    }
    if (node.vendor_node_id) {
        info.vendor_node_id = node.vendor_node_id;
    }
    return info;
}
