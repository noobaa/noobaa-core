// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var restful_api = require('../util/restful_api');
var size_utils = require('../util/size_utils');
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
    read_node: read_node,
    list_nodes: list_nodes,
    nodes_stats: nodes_stats,
    heartbeat: heartbeat,
    get_agents_status: get_agents_status,
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

    // TODO handle vendor_node_desired_state !!
    info.vendor_node_desired_state = true;

    var vendor;
    return Q.fcall(
        function() {
            if (info.vendor) {
                return NodeVendor.findById(info.vendor).exec();
            }
        }
    ).then(
        function(vendor_arg) {
            vendor = vendor_arg;
            if (info.vendor) {
                verify_vendor_found(req.account.id, info.vendor, vendor);
            }
            return EdgeNode.create(info);
        }
    ).then(
        function(node) {
            if (vendor) {
                return agent_host_caller(vendor).start_agent({
                    name: node.name,
                    geolocation: node.geolocation,
                });
            }
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
                throw_node_not_found(node, info.name);
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


function read_node(req) {
    var info = _.pick(req.restful_params, 'name');
    info.account = req.account.id; // see account_server.account_session
    return Q.fcall(
        function() {
            return EdgeNode.findOne(info).exec();
        }
    ).then(
        function(node) {
            throw_node_not_found(node);
            return get_node_info(node);
        }
    );
}


function list_nodes(req) {
    var info = {};
    info.account = req.account.id; // see account_server.account_session
    var query = req.restful_params.query;
    var skip = req.restful_params.skip;
    var limit = req.restful_params.limit;
    if (query) {
        if (query.name) {
            info.name = new RegExp(query.name);
        }
        if (query.geolocation) {
            info.geolocation = new RegExp(query.geolocation);
        }
        if (query.vendor) {
            info.vendor = query.vendor;
        }
    }
    return Q.fcall(
        function() {
            var q = EdgeNode.find(info).sort('-_id');
            if (skip) {
                q.skip(skip);
            }
            if (limit) {
                q.limit(limit);
            }
            return q.exec();
        }
    ).then(
        function(nodes) {
            return {
                nodes: _.map(nodes, get_node_info)
            };
        }
    );
}


function nodes_stats(req) {
    var info = {};
    info.account = req.account.id; // see account_server.account_session
    var group_by = req.restful_params.group_by;
    return Q.fcall(
        function() {
            var reduce_sum = size_utils.reduce_sum;
            return EdgeNode.mapReduce({
                scope: {
                    group_by: group_by,
                    reduce_sum: reduce_sum,
                },
                map: function() {
                    var key = {};
                    if (group_by.geolocation) {
                        key.g = this.geolocation;
                    }
                    if (group_by.vendor) {
                        key.v = this.vendor;
                    }
                    var val = {
                        // count
                        c: 1,
                        // allocated
                        a: this.allocated_storage,
                        // used
                        u: this.used_storage,
                    };
                    /* global emit */
                    emit(key, val);
                },
                reduce: function(key, values) {
                    var c = []; // count
                    var a = []; // allocated
                    var u = []; // used
                    values.forEach(function(v) {
                        c.push(v.c);
                        a.push(v.a);
                        u.push(v.u);
                    });
                    return {
                        c: reduce_sum(key, c),
                        a: reduce_sum(key, a),
                        u: reduce_sum(key, u),
                    };
                }
            });
        }
    ).then(
        function(res) {
            console.log('NODES_STATS', res);
            return {
                groups: _.map(res, function(r) {
                    var group = {
                        count: r.value.c,
                        allocated_storage: r.value.a,
                        used_storage: r.value.u,
                    };
                    if (r._id.g) {
                        group.geolocation = r._id.g;
                    }
                    if (r._id.v) {
                        group.vendor = r._id.v;
                    }
                    return group;
                })
            };
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
        'allocated_storage',
        'system_info'
    );
    updates.ip = (updates.ip && updates.ip !== '0.0.0.0' && updates.ip) ||
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress;
    updates.heartbeat = new Date();

    var agent_used_storage = req.restful_params.used_storage;
    var node;

    return Q.fcall(
        function() {
            return EdgeNode.findOne(info).exec();
        }
    ).then(
        function(node_arg) {
            node = node_arg;
            throw_node_not_found(node, info.name);
            // TODO need to optimize - we read blocks and chunks on every heartbeat...
            return DataBlock.find({
                node: node.id
            }).populate('chunk').exec();
        }
    ).then(
        function(blocks) {
            var real_usage = 0;
            _.each(blocks, function(block) {
                if (block.chunk && block.chunk.kblocks) {
                    real_usage += (block.chunk.size / block.chunk.kblocks) | 0;
                }
            });
            if (node.used_storage !== real_usage) {
                updates.used_storage = real_usage;
            }
            // the agent's used storage is verified but not updated
            if (agent_used_storage !== real_usage) {
                console.log('NODE agent used storage not in sync',
                    agent_used_storage, 'real', real_usage);
                // TODO trigger a usage check
            }

            if (updates.allocated_storage !== node.allocated_storage) {
                console.log('NODE change allocated storage from',
                    node.allocated_storage, 'to', updates.allocated_storage);
                // TODO agent sends allocated_storage but never reads it so it always overrides it...
                //      so for now we just ignore this change from the agent.
                delete updates.allocated_storage;
            }

            // we log the ip and location updates,
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

            return EdgeNode.findByIdAndUpdate(node.id, updates).exec();
        }
    ).then(
        function(node) {
            return get_node_info(node);
        }
    );
}



function agent_host_action(account, node_names, func_name) {
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
            return Q.allSettled(_.map(nodes,
                function(node) {
                    return sem.surround(function() {
                        var params = {
                            name: node.name,
                        };
                        if (func_name === 'start_agent') {
                            params.geolocation = node.geolocation;
                        }
                        return agent_host_caller(node.vendor)[func_name](params);
                    });
                }
            ));
        }
    );
}

function get_agents_status(req) {
    var node_names = req.restful_params.nodes;
    return agent_host_action(req.account, node_names, 'get_agent_status').then(
        function(res) {
            return {
                nodes: _.map(res, function(node_res) {
                    var status = false;
                    if (node_res.state === 'fulfilled' &&
                        node_res.value && node_res.value.status) {
                        status = true;
                    }
                    return {
                        status: status
                    };
                })
            };
        }
    );
}

function start_agents(req) {
    var node_names = req.restful_params.nodes;
    return agent_host_action(req.account, node_names, 'start_agent').thenResolve();
}

function stop_agents(req) {
    var node_names = req.restful_params.nodes;
    return agent_host_action(req.account, node_names, 'stop_agent').thenResolve();
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
                    return _.pick(v, 'id', 'name', 'kind');
                })
            };
        }
    );
}


function connect_node_vendor(req) {
    var vendor_info = _.pick(req.restful_params, 'name', 'kind', 'info');
    vendor_info.account = req.account.id; // see account_server.account_session
    var vendor;
    return Q.fcall(
        function() {
            if (!vendor_info.name) {
                return;
            }
            return NodeVendor.findOne({
                account: req.account.id,
                name: vendor_info.name,
            }).exec();
        }
    ).then(
        function(vendor_arg) {
            if (vendor_arg) {
                return vendor_arg;
            }
            return NodeVendor.create(vendor_info);
        }
    ).then(
        function(vendor_arg) {
            vendor = vendor_arg;
            verify_vendor_found(req.account.id, vendor.id, vendor);
            // find all nodes hosted by this vendor
            return EdgeNode.find({
                account: req.account.id,
                vendor: vendor.id,
            }).select('name').exec();
        }
    ).then(
        function(nodes) {
            var node_names = _.pluck(nodes, 'name');
            return agent_host_action(req.account, node_names, 'start_agent');
        }
    ).then(
        function() {
            return _.pick(vendor, 'id', 'name', 'kind');
        }
    );
}

function verify_vendor_found(account_id, vendor_id, vendor) {
    if (!vendor) {
        console.error('NODE VENDOR NOT FOUND', vendor_id);
        throw new Error('node vendor not found');
    }
    if (String(vendor_id) !== String(vendor.id)) {
        console.error('NODE VENDOR ID MISMATCH', vendor_id, vendor.id);
        throw new Error('node vendor id mismatch');
    }
    if (String(account_id) !== String(vendor.account)) {
        console.error('NODE VENDOR ACCOUNT MISMATCH', account_id, vendor.account);
        throw new Error('node vendor account mismatch');
    }
}

function agent_host_caller(vendor) {
    if (vendor.kind !== 'agent_host') {
        throw new Error('NODE VENDOR KIND UNIMPLEMENTED - ' + vendor.kind);
    }
    var params = _.merge({
        path: '/api/agent_host_api/'
    }, vendor.info);
    return new agent_host_api.Client(params);
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
    info.system_info = node.system_info && node.system_info.toObject() || {};
    if (!info.system_info.os) {
        info.system_info.os = {};
    }
    return info;
}

function throw_node_not_found(node, info) {
    if (!node) {
        var err = new Error('node not found' + (info && ' ' + info || ''));
        err.status = 404;
        throw err;
    }
}
