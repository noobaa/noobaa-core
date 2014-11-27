// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var rest_api = require('../util/rest_api');
var size_utils = require('../util/size_utils');
var api = require('../api');
var system_server = require('./system_server');
var node_monitor = require('./node_monitor');
var Semaphore = require('noobaa-util/semaphore');
var Agent = require('../agent/agent');
var db = require('./db');


module.exports = new api.node_api.Server({

    // CRUD
    create_node: create_node,
    delete_node: delete_node,
    read_node: read_node,

    // LIST
    list_nodes: list_nodes,

    // GROUP
    group_nodes: group_nodes,

    // START STOP
    start_nodes: start_nodes,
    stop_nodes: stop_nodes,
    get_agents_status: get_agents_status,

    // AGENT
    heartbeat: heartbeat,

    // NODE VENDOR
    connect_node_vendor: connect_node_vendor,
}, {
    before: function(req) {
        return req.load_system(['admin']);
    }
});



//////////
// CRUD //
//////////


function create_node(req) {
    var info = _.pick(req.rest_params,
        'name',
        'is_server',
        'geolocation',
        'allocated_storage',
        'vendor_node_id'
    );
    info.system = req.system.id;
    info.started = true;
    info.heartbeat = new Date();
    info.used_storage = 0;

    return Q.fcall(function() {
        return Q.all([
            db.Tier.findOne({
                system: req.system.id,
                name: req.rest_params.tier,
                deleted: null,
            }).exec(),
            req.rest_params.vendor && db.Vendor.findOne({
                system: req.system.id,
                name: req.rest_params.vendor,
                deleted: null,
            }).exec(),
        ]);
    }).then(function(res) {
        info.tier = res[0];
        info.vendor = res[1];
        if (!info.tier || String(info.tier.system) !== String(info.system) || info.tier.deleted) {
            console.error('BAD TIER', info);
            throw req.rest_error('tier not found');
        }
        if (req.rest_params.vendor && (!info.vendor ||
                String(info.vendor.system) !== String(info.system) ||
                info.vendor.deleted)) {
            console.error('BAD VENDOR', info);
            throw req.rest_error('vendor not found');
        }

        return db.Node.create(info);

    }).then(
        null, db.check_already_exists(req, 'node')
    ).then(function(node) {
        if (!info.vendor) return;
        return agent_host_caller(info.vendor).start_agent({
            name: node.name,
            geolocation: node.geolocation,
        });
    }).thenResolve();
}


function delete_node(req) {
    return Q.fcall(function() {
            return db.Node.findOneAndUpdate({
                system: req.system.id,
                name: req.rest_params.name,
                deleted: null,
            }, {
                deleted: new Date()
            }).exec();
        })
        .then(db.check_not_found(req, 'node'))
        .then(function(node) {
            // TODO notify to initiate rebuild of blocks
        })
        .thenResolve();
}


function read_node(req) {
    return find_node_by_name(req, req.rest_params.name)
        .then(function(node) {
            return get_node_info(node);
        });
}



//////////
// LIST //
//////////

function list_nodes(req) {
    var info = {
        system: req.system.id,
        deleted: null,
    };
    var query = req.rest_params.query;
    var skip = req.rest_params.skip;
    var limit = req.rest_params.limit;
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

    return Q.fcall(function() {
            var q = db.Node.find(info).sort('-_id');
            if (skip) {
                q.skip(skip);
            }
            if (limit) {
                q.limit(limit);
            }
            return q.exec();
        })
        .then(function(nodes) {
            return {
                nodes: _.map(nodes, get_node_info)
            };
        });
}



///////////
// GROUP //
///////////

function group_nodes(req) {
    var by_system = {
        system: req.system.id,
        deleted: null,
    };
    var group_by = req.rest_params.group_by;

    return Q.fcall(function() {
        var reduce_sum = size_utils.reduce_sum;
        return db.Node.mapReduce({
            query: by_system,
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

    }).then(function(res) {
        console.log('GROUP NODES', res);
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
    });
}



////////////////
// START STOP //
////////////////

function start_nodes(req) {
    var node_names = req.rest_params.nodes;
    return Q.fcall(update_nodes_started_state, req, node_names, true)
        .then(function(nodes) {
            return agent_host_action(nodes, 'start_agent');
        })
        .thenResolve();
}

function stop_nodes(req) {
    var node_names = req.rest_params.nodes;
    return Q.fcall(update_nodes_started_state, req, node_names, false)
        .then(function(nodes) {
            return agent_host_action(nodes, 'stop_agent');
        })
        .thenResolve();
}



// TODO is this still needed as api method?
function get_agents_status(req) {
    var node_names = req.rest_params.nodes;
    return find_nodes_with_vendors(req, node_names)
        .then(function(nodes) {
            return agent_host_action(nodes, 'get_agent_status');
        })
        .then(function(res) {
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
        });
}



///////////////
// HEARTBEAT //
///////////////

function heartbeat(req) {
    var updates = _.pick(req.rest_params,
        'geolocation',
        'ip',
        'port',
        'allocated_storage',
        'device_info'
    );
    updates.ip = (updates.ip && updates.ip !== '0.0.0.0' && updates.ip) ||
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress;
    updates.heartbeat = new Date();

    var agent_used_storage = req.rest_params.used_storage;
    var node;

    return find_node_by_name(req, req.rest_params.name)
        .then(function(node_arg) {
            node = node_arg;
            // TODO CRITICAL need to optimize - we count blocks on every heartbeat...
            return count_node_used_storage(node.id);
        })
        .then(function(used_storage) {
            if (node.used_storage !== used_storage) {
                updates.used_storage = used_storage;
            }
            // the agent's used storage is verified but not updated
            if (agent_used_storage !== used_storage) {
                console.log('NODE agent used storage not in sync',
                    agent_used_storage, 'real', used_storage);
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

            return db.Node.findByIdAndUpdate(node.id, updates).exec();
        })
        .then(function(node) {
            return get_node_info(node);
        });
}



/////////////////
// NODE VENDOR //
/////////////////

function connect_node_vendor(req) {
    var vendor_info = _.pick(req.rest_params, 'name', 'category', 'kind', 'details');
    vendor_info.system = req.system.id;
    var vendor;

    return Q.fcall(function() {
            if (!vendor_info.name) return;
            return db.Vendor.findOne({
                account: req.account.id,
                name: vendor_info.name,
                deleted: null,
            }).exec();
        })
        .then(function(vendor_arg) {
            if (vendor_arg) {
                return vendor_arg;
            } else {
                return db.Vendor.create(vendor_info);
            }
        })
        .then(null, db.check_already_exists(req, 'vendor'))
        .then(function(vendor_arg) {
            vendor = vendor_arg;

            // find all nodes hosted by this vendor
            return db.Node.find({
                vendor: vendor.id,
                deleted: null,
            }).select('name').exec();
        })
        .then(function(nodes) {
            var node_names = _.pluck(nodes, 'name');
            return agent_host_action(req.account, node_names, 'start_agent');
        })
        .then(function() {
            return _.pick(vendor, 'id', 'name', 'category', 'kind', 'details');
        });
}




///////////
// UTILS //
///////////


function count_node_used_storage(node_id) {
    return Q.when(db.DataBlock.mapReduce({
            query: {
                node: node_id
            },
            map: function() {
                emit('size', this.size);
            },
            reduce: size_utils.reduce_sum
        }))
        .then(function(res) {
            return res && res[0] && res[0].value || 0;
        });
}

function find_node_by_name(req, name) {
    return Q.when(db.Node.findOne({
            system: req.system.id,
            name: name,
            deleted: null,
        }).exec())
        .then(db.check_not_deleted(req, 'node'));
}

function find_nodes_with_vendors(req, node_names) {
    return Q.when(db.Node.find({
            system: req.system.id,
            name: {
                $in: node_names
            },
            deleted: null,
        })
        .populate('vendor')
        .exec());
}


function update_nodes_started_state(req, node_names, started) {
    var nodes;
    return find_nodes_with_vendors(req, node_names)
        .then(function(nodes_arg) {
            nodes = nodes_arg;
            var nodes_to_update = _.compact(_.map(nodes, function(node) {
                if (node.started !== started) {
                    return node;
                }
            }));
            var sem = new Semaphore(3);
            return Q.all(_.map(nodes_to_update, function(node) {
                return sem.surround(function() {
                    var updates = {
                        started: started
                    };
                    return node.update({
                        $set: updates
                    }).exec();
                });
            }));
        })
        .then(function() {
            return agent_host_action(nodes, started ? 'start_agent' : 'stop_agent');
        })
        .thenResolve();
}

function agent_host_action(nodes, func_name) {
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

function agent_host_caller(vendor) {
    if (vendor.kind !== 'agent_host') {
        throw new Error('NODE VENDOR KIND UNIMPLEMENTED - ' + vendor.kind);
    }
    var client = new api.agent_host_api.Client();
    _.each(vendor.info, function(val, key) {
        client.set_option(key, val);
    });
    return client;
}

function get_node_info(node) {
    var info = _.pick(node,
        'name',
        'started',
        'geolocation',
        'allocated_storage',
        'used_storage'
    );
    info.ip = node.ip || '0.0.0.0';
    info.port = node.port || 0;
    info.heartbeat = node.heartbeat.toString();
    info.online = node.started && node.heartbeat >= node_monitor.get_minimum_online_heartbeat();
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
    info.device_info =
        node.device_info &&
        node.device_info.toObject &&
        node.device_info.toObject() || {};
    return info;
}
