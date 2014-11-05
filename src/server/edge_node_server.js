// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var restful_api = require('../util/restful_api');
var fssize_utils = require('../util/fssize_utils');
var edge_node_api = require('../api/edge_node_api');
var account_api = require('../api/account_api');
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
    info.used_storage = {};
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



// TODO the next code is for testing only - manage node agents in the current process TODO

var node_agents = {};
var next_node_num = 0;
var account_client = new account_api.Client({
    path: '/api/account_api/',
    port: 5001, // TODO
});
var edge_node_client = new edge_node_api.Client({
    path: '/api/edge_node_api/',
    port: 5001, // TODO
});

function start_agents(req) {
    var node_names = req.restful_params.nodes;
    return Q.fcall(
        function() {
            return EdgeNode.find({
                account: req.account.id,
                name: {
                    $in: node_names
                }
            }).populate('vendor').exec();
        }
    ).then(
        function(nodes) {
            return start_node_agents(req.account, nodes);
        }
    );
}

function start_node_agents(account, nodes) {
    var sem = new Semaphore(3);
    return Q.all(_.map(nodes,
        function(node) {
            if (node.vendor.kind !== 'noobaa-center') {
                throw new Error('unsupported node vendor for starting');
            }
            var agent = node_agents[node.name] || new Agent({
                account_client: account_client,
                edge_node_client: edge_node_client,
                account_credentials: {
                    email: account.email,
                    password: 'aaa', // TODO
                },
                node_name: node.name,
                node_geolocation: node.geolocation,
            });
            return sem.surround(function() {
                return agent.start();
            }).thenResolve(agent);
        }
    )).then(
        function(new_agents) {
            _.each(new_agents, function(agent) {
                if (agent) {
                    node_agents[agent.node_name] = agent;
                }
            });
        }
    );
}


function stop_agents(req) {
    var node_names = req.restful_params.nodes;
    var sem = new Semaphore(3);
    return Q.all(_.map(node_names,
        function(name) {
            var agent = node_agents[name];
            if (!agent) {
                return;
            }
            return sem.surround(function() {
                return agent.stop().then(
                    function() {
                        delete node_agents[name];
                    }
                );
            });
        }
    ));
}


function get_node_vendors(req) {
    return Q.fcall(
        function() {
            return NodeVendor.find().exec();
        }
    ).then(
        function(vendors) {
            var noobaa_center_vendor_kind = {kind: 'noobaa-center'};
            if (!_.any(vendors, noobaa_center_vendor_kind)) {
                return NodeVendor.create(noobaa_center_vendor_kind).then(
                    function(vendor) {
                        // no reason to read again from the db,
                        // so just adding the new item and keep using the old list. 
                        vendors.push(vendor);
                        return vendors;
                    }
                );
            }
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


function get_node_info(node) {
    var info = _.pick(node,
        'name',
        'geolocation'
    );
    info.ip = node.ip || '0.0.0.0';
    info.port = node.port || 0;
    info.heartbeat = node.heartbeat.toString();
    info.allocated_storage = fssize_utils.clone(node.allocated_storage);
    info.used_storage = fssize_utils.clone(node.used_storage);
    if (node.vendor) {
        info.vendor = mongoose.Types.ObjectId.isValid(node.vendor) ? node.vendor : node.vendor.id;
    }
    if (node.vendor_node_id) {
        info.vendor_node_id = node.vendor_node_id;
    }
    return info;
}
